// Regression: the app still starts and both windows become visible when settings.json holds an old v1 save with out-of-range levels.
export const seed = { 'settings.json': { settings: { theme: 'sakura', hsk: [1, 2, 3, 4, 5], hskOpen: 9 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main');
  await t.step('R9 v1: both windows mount and are shown', async () => {
    await t.waitFor(main, '.page h1');
    t.assert((await t.calls(main, 'plugin:window|show')).length >= 1, 'main window never shown');
    await pet.waitForFunction(() => window.__e2e.calls.some((c) => c.cmd === 'plugin:window|show'), { timeout: 8000 })
      .catch(() => { throw new Error('pet window never shown'); });
  });
  await t.step('R9 v1: settings and topics pages open', async () => {
    await main.evaluate(() => { location.hash = '#/settings'; });
    await t.waitFor(main, '.page h1', 'Cài đặt');
    await main.evaluate(() => { location.hash = '#/topics'; });
    await t.waitFor(main, '.page h1');
    console.log('      saved settings now:', JSON.stringify((await t.store(main, 'settings.json')).settings ?? null).slice(0, 200));
  });
}
