// A lesson number past the end of an HSK course (a stale or hand-typed link) should say the
// lesson does not exist, not blame the learner for having seen too few words.
export const seed = { 'settings.json': { settings: { hskOpen: 5, hsk: [1], settingsVersion: 3, onboarded: true } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  await t.step('a lesson past the end explains itself', async () => {
    await go('#/quiz/meaning/hsk/5/99');
    await t.waitFor(main, '.page .empty');
    const msg = await t.text(main, '.page .empty');
    t.assert(!/Tiểu Mai cho bạn xem/.test(msg), `empty lesson says: "${msg}"`);
  });
}
