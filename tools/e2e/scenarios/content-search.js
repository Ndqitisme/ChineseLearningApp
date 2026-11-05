// Search finds an HSK 5 word by hanzi, toneless pinyin, Vietnamese meaning and Hán Việt only while
// HSK 5 is open: not before unlocking, yes after, and not again after re-locking to 1–3.
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const toneless = (s) => fold(s).replace(/[\s'’·-]/g, '');

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const all = [...t.data.words, ...[4, 5, 6].flatMap((l) => t.packs[l].words)];
  // An HSK 5 pack word whose pinyin, meaning and Hán Việt are each unique, so it must be the top hit.
  const unique = (f, w) => all.filter((x) => f(x) === f(w)).length === 1;
  const w = t.packs[5].words.find((x) => x.hanzi.length === 2 && x.hanviet && !x.vi.includes(x.hanviet) && !x.vi.includes('(')
    && unique((y) => toneless(y.pinyin), x) && unique((y) => fold(y.hanviet ?? ''), x) && unique((y) => y.vi, x)
    && !all.some((y) => y !== x && fold(y.vi + ' ' + (y.viFull ?? '')).startsWith(fold(x.vi.split(';')[0]))));
  t.assert(w, 'no suitable HSK 5 word');
  const queries = [['hanzi', w.hanzi], ['pinyin', toneless(w.pinyin)], ['Vietnamese', w.vi.split(';')[0].trim()], ['Hán Việt', w.hanviet]];

  const main = await t.open('main', '#/search');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  async function search(q) {
    await main.waitForSelector('input.search');
    await main.click('input.search', { count: 3 });
    await main.keyboard.press('Backspace');
    await main.type('input.search', q);
    await t.waitFor(main, '.page > .muted', 'kết quả');
    return main.$$eval('.list .row .hz', (els) => els.map((e) => e.textContent.trim()));
  }
  async function setLevel(n) {
    await go('#/settings/hsk');
    await t.click(main, '.chip', `HSK 1–${n}`);
    await main.waitForFunction((k) => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === k, {}, n);
    await go('#/search');
  }

  await t.step(`locked: ${w.hanzi} is not found`, async () => {
    for (const [kind, q] of queries) {
      const hits = await search(q);
      t.assert(!hits.includes(w.hanzi), `${kind} "${q}" finds locked ${w.hanzi}`);
    }
    await search(w.hanzi);
    const empty = await t.text(main, '.page .empty');
    t.assert(/HSK 1–3/.test(empty ?? ''), `empty text: "${empty}"`);
  });

  await t.step('unlock HSK 1–5: found by all four', async () => {
    await setLevel(5);
    for (const [kind, q] of queries) {
      const hits = await search(q);
      t.assert(hits[0] === w.hanzi, `${kind} "${q}": top hit ${hits[0]}, expected ${w.hanzi} (${hits.slice(0, 5)})`);
    }
  });

  await t.step('the HSK 5 hit shows its pinyin, meaning and Hán Việt', async () => {
    await search(w.hanzi);
    const row = await main.$eval('.list .row', (r) => ({ py: r.querySelector('.py').textContent.replace(/\s/g, ''), vi: r.querySelector('.vi').textContent, hv: r.querySelector('.hv').textContent.trim() }));
    t.assert(row.py === w.pinyin.replace(/\s/g, '') && row.vi === w.vi && row.hv === w.hanviet, `row ${JSON.stringify(row)}`);
  });

  await t.step('an HSK 6 word is still not found with 1–5 open', async () => {
    const six = t.packs[6].words.find((x) => x.hanzi.length === 2 && !all.some((y) => y !== x && y.hanzi.includes(x.hanzi)));
    const hits = await search(six.hanzi);
    t.assert(!hits.includes(six.hanzi), `HSK 6 ${six.hanzi} found with HSK 1–5 open`);
  });

  await t.step('re-lock to 1–3: gone again', async () => {
    await setLevel(3);
    for (const [kind, q] of queries) {
      const hits = await search(q);
      t.assert(!hits.includes(w.hanzi), `${kind} "${q}" still finds ${w.hanzi} after re-locking`);
    }
  });
}
