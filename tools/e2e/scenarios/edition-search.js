// Search keeps words of both editions: a 2025-only and a 2021-only word are found under either edition, by hanzi
// and toneless pinyin. Results never include a word of a locked level (HSK 4–6 in both editions here).
export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const plain = (w) => !w.topics.length;
  const only2025 = t.data.words.find((w) => w.id === '过节') ?? t.data.words.find((w) => plain(w) && !w.hsk && w.hsk2025);
  const only2021 = t.data.words.find((w) => w.id === '班长') ?? t.data.words.find((w) => plain(w) && w.hsk && !w.hsk2025);
  const toneless = (w) => w.pinyin.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
  const byId = new Map(t.data.words.map((w) => [w.id, w]));

  const main = await t.open('main', '#/');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const search = async (q) => {
    await go('#/');
    await go(`#/search/${encodeURIComponent(q)}`);
    await t.waitFor(main, 'p.muted', 'kết quả');
    return main.$$eval('a.row', (els) => els.map((a) => decodeURIComponent(a.getAttribute('href').replace('#/word/', ''))));
  };
  const setEdition = async (e) => {
    await go('#/settings/hsk');
    await t.click(main, '.chip', `Bản ${e}`);
    await main.waitForFunction((v) => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === v, { timeout: 5000 }, e);
  };
  const locked = (ids) => ids.filter((id) => { const w = byId.get(id); return w && !w.topics.length && !((w.hsk ?? 9) <= 3 || (w.hsk2025 ?? 9) <= 3); });

  for (const e of [2021, 2025, 2021]) {
    await t.step(`${e}: ${only2025.hanzi} (2025-only) and ${only2021.hanzi} (2021-only) are both found`, async () => {
      await setEdition(e);
      for (const w of [only2025, only2021]) {
        for (const q of [w.hanzi, toneless(w)]) {
          const ids = await search(q);
          t.assert(ids.includes(w.id), `search "${q}" under ${e}: ${w.id} missing (${ids.slice(0, 8)})`);
          const leak = locked(ids);
          t.assert(!leak.length, `search "${q}" under ${e} shows words of locked levels: ${leak.slice(0, 5)}`);
        }
      }
    });
  }

  await t.step('a search with no hit names the open levels', async () => {
    await go('#/');
    await go(`#/search/${encodeURIComponent('zzzz')}`);
    await t.waitFor(main, 'p.empty', 'HSK 1–3');
  });

  await t.step('Back from a word page brings the typed query and its results back', async () => {
    await go('#/');
    await go('#/search');
    await main.waitForSelector('input.search');
    await main.type('input.search', toneless(only2021));
    await t.waitFor(main, 'a.row');
    await main.waitForFunction((q) => decodeURIComponent(location.hash) === `#/search/${q}`, { timeout: 3000 }, toneless(only2021));
    await main.click('a.row');
    await main.waitForFunction(() => location.hash.startsWith('#/word/'), { timeout: 3000 });
    await main.evaluate(() => history.back());
    await main.waitForFunction((q) => document.querySelector('input.search')?.value === q, { timeout: 3000 }, toneless(only2021));
    await t.waitFor(main, 'a.row');
  });
}
