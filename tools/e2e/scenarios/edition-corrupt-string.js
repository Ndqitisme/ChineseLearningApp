// A hand-edited save with hskEdition "2021" (a string) loads as the 2025 lists (the default), without errors in either window.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, hskEdition: '2021' } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/topics');
  const hsk1 = () => main.$$eval('.card.topic', (cs) => cs.find((c) => c.querySelector('b')?.textContent.trim() === 'HSK 1')?.querySelector('.count')?.textContent.trim());

  await t.step('Topics shows Bản 2025 and the 2025 counts', async () => {
    await t.waitFor(main, '.edition .chip.on', 'Bản 2025');
    t.assert((await hsk1()) === `${t.data.hsk2025[1].length} từ`, `HSK 1 ${await hsk1()}`);
  });
  await t.step('the assistant shows a 2025 HSK 1 word', async () => {
    // Puppeteer's waits poll on animation frames, which only run in the tab in front.
    await pet.bringToFront();
    await t.waitFor(pet, '.bubble .hanzi', undefined, 20_000);
    const h = await t.text(pet, '.bubble .hanzi');
    const label = await t.text(pet, '.bubble .hsk');
    const w = t.data.words.find((x) => x.hanzi === h);
    t.assert(w, `bubble word ${h} not in the core`);
    t.assert(!label || label === `HSK ${w.hsk2025}`, `bubble label ${label} for ${h} (2025 level ${w.hsk2025})`);
  });
  await t.step('Settings shows Bản 2025 on and switching still saves a number', async () => {
    await main.bringToFront();
    await main.evaluate(() => { location.hash = '#/settings/hsk'; });
    await t.waitFor(main, '.chip.on', 'Bản 2025');
    await t.click(main, '.chip', 'Bản 2021');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === 2021, { timeout: 5000 });
  });
}
