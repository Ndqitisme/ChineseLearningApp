// The assistant follows an edition switch made in the main window, without reopening: its word pool and the
// "HSK n" label move with it. Only HSK 2 is on, no topics.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, topics: [], hsk: [2], guessFirst: false } } };

const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/');
  const pet = await t.open('pet');
  // Puppeteer's waits poll on animation frames, which only run in the tab in front.
  const go = async (hash) => { await main.bringToFront(); await main.evaluate((h) => { location.hash = h; }, hash); };
  const byHanzi = (h) => t.data.words.filter((w) => w.hanzi === h);
  const ids = { 2021: new Set(t.data.hsk[2]), 2025: new Set(t.data.hsk2025[2]) };
  const level = (w, e) => (e === 2025 ? w.hsk2025 : w.hsk);
  const current = async () => ({ hanzi: await t.text(pet, '.bubble .hanzi'), label: await t.text(pet, '.bubble .hsk') });
  const bubbleWords = async (n) => {
    const seen = [];
    for (let i = 0; i < n; i++) {
      await t.emitTo(main, 'pet', 'tray:command', 'next');
      await wait(pet, 1800);
      const c = await current();
      if (c.hanzi) seen.push(c);
    }
    return seen;
  };
  const checkPool = (seen, e) => {
    t.assert(seen.length >= 4, `only ${seen.length} bubble words`);
    for (const { hanzi, label } of seen) {
      const ws = byHanzi(hanzi);
      t.assert(ws.some((w) => ids[e].has(w.id)), `${e}: bubble showed ${hanzi}, not in the ${e} HSK 2 list (levels ${ws.map((w) => `${w.hsk}/${w.hsk2025}`)})`);
      t.assert(label === 'HSK 2', `${e}: bubble label "${label}" for ${hanzi}`);
    }
  };

  await t.step('2021: the bubble shows 2021 HSK 2 words labelled HSK 2', async () => {
    await pet.bringToFront();
    await t.waitFor(pet, '.bubble .hanzi', undefined, 20_000);
    const seen = await bubbleWords(6);
    console.log(`      2021 bubble: ${seen.map((s) => s.hanzi).join(' ')}`);
    checkPool(seen, 2021);
  });

  await t.step('switch to 2025 in the main window: the current label follows at once', async () => {
    await go('#/settings/hsk');
    await t.click(main, '.chip', 'Bản 2025');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === 2025, { timeout: 5000 });
    await wait(pet, 500);
    const { hanzi, label } = await current();
    const w = byHanzi(hanzi)[0];
    const want = w && level(w, 2025) ? `HSK ${level(w, 2025)}` : null;
    t.assert(label === want, `after the switch ${hanzi} is labelled "${label}", its 2025 level is ${want}`);
  });

  await t.step('2025: the next words come from the 2025 HSK 2 list', async () => {
    const seen = await bubbleWords(6);
    console.log(`      2025 bubble: ${seen.map((s) => s.hanzi).join(' ')}`);
    checkPool(seen, 2025);
  });

  await t.step('back to 2021 on Topics: the pool follows again', async () => {
    await go('#/topics');
    await t.click(main, '.edition .chip', 'Bản 2021');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === 2021, { timeout: 5000 });
    checkPool(await bubbleWords(5), 2021);
  });
}
