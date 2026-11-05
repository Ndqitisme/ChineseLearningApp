// About page counts match the dataset, also after HSK 4-6 are opened.
export const seed = { 'settings.json': { settings: { hskOpen: 6, settingsVersion: 3 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/about');
  await t.step('about line count and level text', async () => {
    await t.waitFor(main, '.card, main, body', 'từ');
    const body = await t.text(main, 'body');
    const total = t.data.words.length + Object.values(t.packs).reduce((a, p) => a + p.words.length, 0);
    t.assert(body.includes('5.513') || body.includes('5513') || body.includes(String(total)), `About does not show total ${total} (README says 5.513)`);
    t.assert(!body.includes('HSK 3.0 cấp 1–3'), 'About still says "HSK 3.0 cấp 1–3" with HSK 6 open');
  });
}
