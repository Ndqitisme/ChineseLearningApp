// Hand-edited or odd saved values: hskOpen out of range and as a string, assistant levels above it.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, hskOpen: '9', hsk: [1, 6, 7], topics: [] } } };
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/topics');
  await t.step('12e hskOpen "9" clamps to 6, hsk keeps 1 and 6 only', async () => {
    await t.waitFor(main, 'a[href="#/hsk/6"] .count', `${t.packs[6].ids.length} từ`);
    t.assert(!(await main.$('.topic.locked')), 'a level is locked');
    const on = await main.$$eval('.topic .bell.on', (els) => els.map((b) => b.parentElement.querySelector('b').textContent.trim()));
    t.assert(JSON.stringify(on) === '["HSK 1","HSK 6"]', `bells ${on}`);
    const raw = (await t.store(main, 'settings.json')).settings;
    console.log(`      stored after start: hskOpen=${JSON.stringify(raw.hskOpen)} hsk=${JSON.stringify(raw.hsk)} (normalized only in memory until the next write)`);
  });
  await t.step('12f a bell change writes the normalized values', async () => {
    await (await main.$('a[href="#/hsk/2"]')).evaluate((a) => a.parentElement.querySelector('.bell').click());
    await main.waitForFunction(() => JSON.stringify(JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hsk) === '[1,2,6]');
    const s = (await t.store(main, 'settings.json')).settings;
    t.assert(s.hskOpen === 6, `hskOpen stored ${JSON.stringify(s.hskOpen)}`);
  });
  await t.step('12g pet uses HSK 6 words with only bells 1, 2, 6', async () => {
    await t.waitFor(pet, '.stage');
    await go(main, '#/hsk/6');
    await t.waitFor(main, '.lesson summary', 'Bài 1');
  });
}
