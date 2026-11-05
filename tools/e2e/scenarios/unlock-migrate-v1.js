// A v1 install (no settingsVersion) still gets the v2 theme move, plus v3's hskOpen.
export const seed = { 'settings.json': { settings: { theme: 'sakura', topics: ['dishes'], hsk: [1, 2], wordSec: 12 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/');
  await t.step('12d v1 settings: sakura moves to ocean once, the rest stays', async () => {
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.settingsVersion === 3);
    const s = (await t.store(main, 'settings.json')).settings;
    t.assert(s.theme === 'ocean', `theme ${s.theme}`);
    t.assert(s.wordSec === 12 && JSON.stringify(s.topics) === '["dishes"]' && JSON.stringify(s.hsk) === '[1,2]', JSON.stringify(s));
    t.assert(s.hskOpen === 3, `hskOpen ${s.hskOpen}`);
  });
}
