// Search follows the edition: a 2025-only word is found only under 2025, a 2021-only word only under 2021, by hanzi
// and toneless pinyin. Results never include a word the chosen edition does not list, except topic words.
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
  const outside = (ids, e) => ids.filter((id) => { const w = byId.get(id); return w && !w.topics.length && !(e === 2025 ? w.hsk2025 : w.hsk); });

  for (const e of [2021, 2025, 2021]) {
    await t.step(`${e}: ${only2025.hanzi} (2025-only) and ${only2021.hanzi} (2021-only)`, async () => {
      await setEdition(e);
      for (const [w, listed] of [[only2025, e === 2025], [only2021, e === 2021]]) {
        for (const q of [w.hanzi, toneless(w)]) {
          const ids = await search(q);
          t.assert(ids.includes(w.id) === listed, `search "${q}" under ${e}: ${w.id} ${listed ? 'missing' : 'shown'} (${ids.slice(0, 8)})`);
          const leak = outside(ids, e);
          t.assert(!leak.length, `search "${q}" under ${e} shows words outside that edition: ${leak.slice(0, 5)}`);
        }
      }
    });
  }

  await t.step('2025: a search with no hit names the open levels', async () => {
    await setEdition(2025);
    await go('#/');
    await go(`#/search/${encodeURIComponent(only2021.hanzi)}`);
    await t.waitFor(main, 'p.muted', 'kết quả');
    const empty = await t.text(main, 'p.empty');
    console.log(`      2025 search ${only2021.hanzi}: ${empty ?? '(results)'}`);
  });
}
