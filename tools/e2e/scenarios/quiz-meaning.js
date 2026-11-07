// Meaning quiz: a right answer turns green and creates a review card, a wrong one shows the
// right answer next to it, and Enter moves on.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/quiz/meaning/topic/greetings');
  const meaningsOf = (hanzi) => t.data.words.filter((w) => w.hanzi === hanzi).map((w) => w.vi);
  const optionTexts = () => main.$$eval('.option', (os) => os.map((o) => o.innerText.replace(/^\d\s*/, '').trim()));

  let first;
  await t.step('answer right', async () => {
    await t.waitFor(main, '.prompt');
    first = await t.text(main, '.prompt');
    const right = meaningsOf(first);
    const options = await optionTexts();
    const i = options.findIndex((o) => right.includes(o));
    t.assert(i >= 0, `no option matches ${first} (${right}); options: ${options}`);
    await (await main.$$('.option'))[i].click();
    await t.waitFor(main, '.option.right');
    t.assert(!(await main.$('.option.wrong')), 'a right answer was marked wrong');
    const answer = await t.text(main, '.answer');
    t.assert(answer?.includes(first), `answer line "${answer}" lacks ${first}`);
  });

  await t.step('right answer is saved as a review card', async () => {
    const id = t.data.words.find((w) => w.hanzi === first).id;
    await main.waitForFunction((k) => JSON.parse(localStorage.getItem('e2e:store:progress.json') ?? '{}').srs?.[k], {}, id);
    const progress = await t.store(main, 'progress.json');
    t.assert(progress.srs[id].reps === 1, `card reps ${progress.srs[id].reps}`);
  });

  await t.step('next question', async () => {
    await t.click(main, 'button', 'Tiếp');
    await t.waitFor(main, '.count', 'Câu 2/');
    t.assert(!(await main.$('.answer')), 'answer still shown on the next question');
  });

  await t.step('answer wrong', async () => {
    const right = meaningsOf(await t.text(main, '.prompt'));
    const options = await optionTexts();
    const i = options.findIndex((o) => !right.includes(o));
    await main.keyboard.press(String(i + 1));
    await t.waitFor(main, '.option.wrong');
    const shown = await t.text(main, '.option.right');
    t.assert(right.some((r) => shown?.endsWith(r)), `correct option not highlighted: "${shown}"`);
  });

  await t.step('hover the answered prompt: its tooltip shows', async () => {
    const p = await main.$eval('.prompt', (el) => {
      const r = document.createRange();
      r.setStart(el.firstChild, 0);
      r.setEnd(el.firstChild, 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await main.mouse.move(p.x - 30, p.y);
    await main.mouse.move(p.x, p.y, { steps: 3 });
    await t.waitFor(main, '.tip');
  });

  await t.step('Enter goes on and the old tooltip goes with it', async () => {
    await main.keyboard.press('Enter');
    await t.waitFor(main, '.count', 'Câu 3/');
    await main.waitForFunction(() => !document.querySelector('.tip'), { timeout: 3000 });
  });

  await t.step('Enter on the focused "Tiếp" button moves on one question only', async () => {
    await main.keyboard.press('1');
    await t.waitFor(main, '.next .btn');
    await main.focus('.next .btn');
    await main.keyboard.press('Enter');
    await t.waitFor(main, '.count', 'Câu 4/');
    await main.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    t.assert((await t.text(main, '.count'))?.startsWith('Câu 4/'), `skipped to ${await t.text(main, '.count')}`);
  });

  await t.step('Back returns to the topic the quiz came from', async () => {
    await main.click('.back-btn');
    await main.waitForFunction(() => location.hash === '#/topic/greetings', { timeout: 3000 });
  });
}
