// A save with hskEdition 1999 loads as the 2021 lists, without errors. Word pages and About still work.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false, hskEdition: 1999 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/topics');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);

  await t.step('Topics shows Bản 2021 and the 2021 counts', async () => {
    await t.waitFor(main, '.edition .chip.on', 'Bản 2021');
    const hsk1 = await main.$$eval('.card.topic', (cs) => cs.find((c) => c.querySelector('b')?.textContent.trim() === 'HSK 1')?.querySelector('.count')?.textContent.trim());
    t.assert(hsk1 === '506 từ', `HSK 1 ${hsk1}`);
  });
  await t.step('a 2021-only word opens normally', async () => {
    await go(`#/word/${encodeURIComponent('爸')}`);
    await t.waitFor(main, '.chips .chip', 'HSK 1');
  });
  await t.step('About names the 2021 lists', async () => {
    await go('#/about');
    await t.waitFor(main, '.page', 'bộ từ bản 2021');
  });
}
