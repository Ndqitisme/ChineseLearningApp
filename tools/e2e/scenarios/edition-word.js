// Word pages under both editions: a word shows the chosen edition's level and the other's. A word stays open while
// either edition lists it at an open level, so search, review and the notebook never lead to a dead page. A word
// at a locked level in both editions says so. A topic word stays open.
const pick = (data, cond, why) => {
  const w = data.words.find(cond);
  if (!w) throw new Error(`no word: ${why}`);
  return w;
};
export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false, hskEdition: 2021 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const plain = (w) => !w.topics.length;
  // Different levels in the two editions, both within HSK 1–3.
  const both = pick(t.data, (w) => plain(w) && w.hsk && w.hsk2025 && w.hsk !== w.hsk2025 && w.hsk <= 3 && w.hsk2025 <= 3, 'different levels, both ≤ 3');
  // 2021 HSK 4 but 2025 HSK 3: locked under 2021, open under 2025.
  const up = pick(t.data, (w) => plain(w) && w.hsk === 4 && w.hsk2025 === 3, '2021 HSK 4 / 2025 HSK 3');
  const only2021 = pick(t.data, (w) => plain(w) && w.hsk === 1 && !w.hsk2025, '2021-only');
  const only2025 = pick(t.data, (w) => plain(w) && !w.hsk && w.hsk2025 === 3, '2025-only');
  const topic2021 = pick(t.data, (w) => w.topics.length && w.hsk && !w.hsk2025, 'topic word only 2021 lists');
  // HSK 4 in both editions: locked with HSK 1–3 open, whatever the edition.
  const four = t.packs[4].words.find((w) => plain(w) && w.hsk === 4 && w.hsk2025 === 4);
  console.log(`      words: ${both.hanzi} ${up.hanzi} ${only2021.hanzi} ${only2025.hanzi} topic ${topic2021.hanzi}`);

  const main = await t.open('main', '#/');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  // The hero draws the characters as strokes, so wait for the meaning or the hanzi in a notice.
  const open = async (w) => {
    await go('#/');
    await go(`#/word/${encodeURIComponent(w.id)}`);
    await main.waitForFunction((vi, hz) => document.querySelector('.hero .vi')?.textContent === vi || document.querySelector('p.empty')?.textContent.includes(hz),
      { timeout: 8000 }, w.vi, w.hanzi);
  };
  const chips = () => t.texts(main, '.chips .chip');
  const setEdition = async (e) => {
    await go('#/settings/hsk');
    await t.click(main, '.chip', `Bản ${e}`);
    await main.waitForFunction((v) => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === v, { timeout: 5000 }, e);
  };
  const otherOnly = async (w, other, level) => {
    await open(w);
    await t.waitFor(main, '.chips .chip');
    const c = await chips();
    t.assert(!c.some((x) => /^HSK \d$/.test(x)) && c.includes(`Bản ${other}: HSK ${level}`), `${w.hanzi} chips ${c}`);
  };

  await t.step('2021: word at different levels shows HSK 2021 and the 2025 level', async () => {
    await open(both);
    await t.waitFor(main, '.chips .chip');
    const c = await chips();
    t.assert(c[0] === `HSK ${both.hsk}` && c.includes(`Bản 2025: HSK ${both.hsk2025}`), `${both.hanzi} chips ${c}`);
    const href = await main.$eval('.chips a.chip', (a) => a.getAttribute('href'));
    t.assert(href === `#/hsk/${both.hsk}`, `level chip links ${href}`);
  });

  await t.step('2021: a 2021 HSK 4 word stays open through its 2025 HSK 3', async () => {
    await open(up);
    await t.waitFor(main, '.chips .chip');
    const c = await chips();
    t.assert(c[0] === 'HSK 4' && c.includes('Bản 2025: HSK 3'), `${up.hanzi} chips ${c}`);
  });

  await t.step('a word at HSK 4 in both editions is locked with HSK 1–3 open', async () => {
    await open(four);
    await t.waitFor(main, 'p.empty', 'thuộc HSK 4, cấp này đang khoá');
    t.assert(!(await main.$('.hero')), `${four.hanzi} shows its card while locked`);
  });

  await t.step('2021: 2021-only word shows "Bản 2025: không có"', async () => {
    await open(only2021);
    await t.waitFor(main, '.chips .chip');
    const c = await chips();
    t.assert(c[0] === `HSK ${only2021.hsk}` && c.includes('Bản 2025: không có'), `${only2021.hanzi} chips ${c}`);
  });

  await t.step('2021: 2025-only word opens with "Bản 2025: HSK 3"', async () => otherOnly(only2025, 2025, only2025.hsk2025));

  await t.step('switch to 2025 in Settings', async () => setEdition(2025));

  await t.step('2025: the 2025-only word now opens at its 2025 level', async () => {
    await open(only2025);
    await t.waitFor(main, '.chips .chip');
    const c = await chips();
    t.assert(c[0] === `HSK ${only2025.hsk2025}` && c.includes('Bản 2021: không có'), `${only2025.hanzi} chips ${c}`);
  });

  await t.step('2025: 2021 HSK 4 word shows "HSK 3" and "Bản 2021: HSK 4"', async () => {
    await open(up);
    await t.waitFor(main, '.chips .chip');
    const c = await chips();
    t.assert(c[0] === 'HSK 3' && c.includes('Bản 2021: HSK 4'), `${up.hanzi} chips ${c}`);
  });

  await t.step('2025: word at different levels shows the 2025 level first', async () => {
    await open(both);
    await t.waitFor(main, '.chips .chip');
    const c = await chips();
    t.assert(c[0] === `HSK ${both.hsk2025}` && c.includes(`Bản 2021: HSK ${both.hsk}`), `${both.hanzi} chips ${c}`);
  });

  await t.step('2025: 2021-only word opens with "Bản 2021: HSK 1"', async () => otherOnly(only2021, 2021, only2021.hsk));

  await t.step('2025: a topic word the 2025 lists leave out stays open', async () => {
    await open(topic2021);
    await t.waitFor(main, '.hero');
    const c = await chips();
    t.assert(!c.some((x) => /^HSK \d$/.test(x)) && c.includes(`Bản 2021: HSK ${topic2021.hsk}`), `${topic2021.hanzi} chips ${c}`);
  });

  await t.step('2025: the topic page still lists that word', async () => {
    await go(`#/topic/${topic2021.topics[0]}`);
    await t.waitFor(main, 'a.row');
    const ids = await main.$$eval('a.row', (els) => els.map((a) => decodeURIComponent(a.getAttribute('href').replace('#/word/', ''))));
    t.assert(ids.includes(topic2021.id), `topic ${topic2021.topics[0]} lacks ${topic2021.id}`);
  });

  await t.step('back to 2021: the 2021-only word opens again', async () => {
    await setEdition(2021);
    await open(only2021);
    await t.waitFor(main, '.chips .chip', `HSK ${only2021.hsk}`);
  });
}
