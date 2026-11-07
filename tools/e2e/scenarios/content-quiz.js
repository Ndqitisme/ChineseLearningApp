// HSK 5 lesson quizzes after HSK 1–6 were unlocked and re-locked to 1–5: options are distinct, wrong
// options come only from open words (never the still-loaded HSK 6 pack), and the right option is marked.
export const seed = { 'settings.json': { settings: { hskEdition: 2021, hskOpen: 6, hsk: [1], settingsVersion: 3, onboarded: true, mode: 'light' } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const all = [...t.data.words, ...[4, 5, 6].flatMap((l) => t.packs[l].words)];
  const byHanzi = (h) => all.filter((w) => w.hanzi === h);
  const isOpen5 = (w) => !w.hsk || w.hsk <= 5 || w.topics.length > 0;
  const lessonIds = (n) => t.packs[5].ids.slice((n - 1) * 25, n * 25);
  const main = await t.open('main', '#/settings/hsk');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);

  await t.step('re-lock to HSK 1–5 (HSK 6 pack stays loaded)', async () => {
    await t.click(main, '.chip', 'HSK 1–5');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json')).settings.hskOpen === 5);
  });

  for (const [mode, lesson] of [['meaning', 1], ['hanzi', 2]]) {
    await go(`#/quiz/${mode}/hsk/5/${lesson}`);
    await t.waitFor(main, '.lead', `HSK 5 · Bài ${lesson}`);
    const ids = new Set(lessonIds(lesson));
    let right = 0;
    for (let q = 1; q <= 10; q++) {
      await t.step(`${mode} quiz, question ${q}`, async () => {
        await t.waitFor(main, '.count', `Câu ${q}/10`);
        const prompt = await t.text(main, mode === 'meaning' ? '.prompt' : '.vi-prompt');
        const options = await main.$$eval('.option', (os) => os.map((o) => o.innerText.replace(/^\d\s*/, '').trim()));
        t.assert(options.length === 4, `${options.length} options`);
        t.assert(new Set(options).size === 4, `options repeat: ${options}`);
        const asked = mode === 'meaning'
          ? byHanzi(prompt).find((w) => ids.has(w.id))
          : all.find((w) => ids.has(w.id) && w.vi === prompt);
        t.assert(asked, `prompt "${prompt}" is not an HSK 5 lesson ${lesson} word`);
        // Every option belongs to some open word; none only to HSK 6.
        for (const o of options) {
          const owners = mode === 'meaning' ? all.filter((w) => w.vi === o) : byHanzi(o);
          t.assert(owners.some(isOpen5), `option "${o}" comes from a locked word (${owners.map((w) => `${w.hanzi} HSK${w.hsk}`)})`);
        }
        const correctText = mode === 'meaning' ? asked.vi : asked.hanzi;
        const ci = options.indexOf(correctText);
        t.assert(ci >= 0, `right answer "${correctText}" missing from ${options}`);
        const pick = q % 2 ? ci : (ci + 1) % 4;
        if (pick === ci) right++;
        await main.keyboard.press(String(pick + 1));
        await t.waitFor(main, '.option.right');
        const marked = await main.$$eval('.option.right', (os) => os.map((o) => o.innerText.replace(/^\d\s*/, '').trim()));
        t.assert(marked.length === 1 && marked[0] === correctText, `marked right: ${marked}, expected ${correctText}`);
        t.assert(!!(await main.$('.option.wrong')) === (pick !== ci), 'wrong mark does not match the pick');
        const answer = await t.text(main, '.answer');
        t.assert(answer.includes(asked.hanzi) && answer.includes(asked.vi), `answer line "${answer}"`);
        t.assert(answer.includes('Hán Việt') === !!asked.hanviet, `Hán Việt in answer line: "${answer}" (word has ${asked.hanviet ?? 'none'})`);
        await main.keyboard.press('Enter');
      });
    }
    await t.step(`${mode} quiz result`, async () => {
      await t.waitFor(main, '.done h2', `Đúng ${right}/10 câu`);
      const srs = (await t.store(main, 'progress.json')).srs;
      t.assert(Object.keys(srs).some((id) => ids.has(id)), 'no review card saved for the lesson');
    });
  }

  await t.step('hanzi quiz never offers a second option with the same meaning', async () => {
    // Runs the app's own deck module inside the page, in chunks so no call exceeds the protocol timeout.
    const clashes = [];
    const ids = t.packs[5].ids;
    for (let start = 0; start < ids.length; start += 100) {
      clashes.push(...await main.evaluate(async (chunk) => {
        const { distractors } = await import('/src/main/deck.ts');
        const { wordById } = await import('/src/lib/data.ts');
        const out = [];
        for (const id of chunk) {
          const w = wordById.get(id);
          for (let i = 0; i < 40; i++) {
            const twin = distractors(w, 3, (x) => x.hanzi).find((d) => d.vi === w.vi);
            if (twin) { out.push(`${w.hanzi}/${twin.hanzi} "${w.vi}"`); break; }
          }
        }
        return out;
      }, ids.slice(start, start + 100)));
    }
    t.assert(!clashes.length, `${clashes.length} HSK 5 words can get a same-meaning distractor in "Chọn mặt chữ": ${clashes.slice(0, 8).join('; ')}`);
  });

  await t.step('last HSK 5 lesson (9 words) still makes a round', async () => {
    const last = Math.ceil(t.packs[5].ids.length / 25);
    await go(`#/quiz/meaning/hsk/5/${last}`);
    await t.waitFor(main, '.count', 'Câu 1/');
    const n = await t.text(main, '.count');
    t.assert(n === `Câu 1/${Math.min(10, t.packs[5].ids.length - (last - 1) * 25)}`, `count ${n}`);
  });

}
