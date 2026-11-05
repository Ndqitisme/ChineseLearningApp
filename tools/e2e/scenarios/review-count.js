// The nav badge, Home, the Practice button and the Review page show the same count: due cards plus new words.
const nowMin = Date.now() / 60000;
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const card = { due: yesterday, stability: 3, difficulty: 5, elapsed_days: 3, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: yesterday };
const DUE = ['学生', '老师'];
const FRESH = ['朋友', '喜欢', '吃饭'];
export const seed = {
  'settings.json': { settings: { petEnabled: false, settingsVersion: 3, onboarded: true } },
  'progress.json': {
    srs: Object.fromEntries(DUE.map((id) => [id, card])),
    exposure: Object.fromEntries(FRESH.map((id, i) => [id, { n: 5, t: nowMin - 5 - i }])),
  },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const want = String(DUE.length + FRESH.length);
  const main = await t.open('main', '#/');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);

  await t.step('nav badge and Home count due cards plus new words', async () => {
    await t.waitFor(main, '.stats .stat');
    t.assert((await t.text(main, 'nav .badge')) === want, `nav badge "${await t.text(main, 'nav .badge')}", want ${want}`);
    const home = await main.$$eval('.stats .stat', (ss) => ss.map((s) => s.innerText.replace(/\s+/g, ' ').trim()));
    t.assert(home.some((s) => s.startsWith(`${want} thẻ cần ôn`)), `Home stats ${home.join(' | ')}`);
  });

  await t.step('Practice button shows the same count', async () => {
    await go('#/practice');
    await t.waitFor(main, 'a', `Ôn tập (${want})`);
  });

  await t.step('Review page says the same number', async () => {
    await go('#/review');
    await t.waitFor(main, '.status .remaining', `Còn ${want} thẻ cần ôn`);
  });
}
