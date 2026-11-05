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

  await t.step('Enter goes on', async () => {
    await main.keyboard.press('Enter');
    await t.waitFor(main, '.count', 'Câu 3/');
  });
}
