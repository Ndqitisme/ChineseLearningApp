// Word pages for HSK 4–6 words with HSK 6 open: tone-coloured pinyin, Hán Việt only for a "show"
// verdict, one stroke board per character, and an HSK chip that opens the word's course. Re-locked to
// 1–3, a topic word's HSK 5 chip explains the lock.
import { readFileSync } from 'node:fs';

export const seed = { 'settings.json': { settings: { hskEdition: 2021, hskOpen: 6, hsk: [1], settingsVersion: 3, onboarded: true } } };
const verdicts = new Map(readFileSync('data/hanviet/word-verdicts.tsv', 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => l.split('\t')).map(([w, v]) => [w, v]));

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const p = t.packs;
  const pick = (words, f) => words.find(f);
  const cases = [
    ['HSK 4 Hán Việt word', pick(p[4].words, (w) => w.hanzi.length === 2 && verdicts.get(w.hanzi) === 'show')],
    ['HSK 5 hidden Hán Việt, neutral tone', pick(p[5].words, (w) => w.hanzi.length === 2 && verdicts.get(w.hanzi) === 'hide' && w.syllables.some((s) => s.tone === 5))],
    ['HSK 6 single character', pick(p[6].words, (w) => w.hanzi.length === 1 && verdicts.get(w.hanzi) === 'show')],
    ['HSK 6 four-character word', pick(p[6].words, (w) => [...w.hanzi].length === 4)],
  ];
  const main = await t.open('main');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);

  for (const [label, w] of cases) {
    await t.step(`${label}: ${w.hanzi}`, async () => {
      await go(`#/word/${encodeURIComponent(w.id)}`);
      await t.waitFor(main, '.hero .vi', w.vi);
      const tones = await main.$$eval('.hero .py .pinyin span', (ss) => ss.map((s) => ({ c: s.className, color: getComputedStyle(s).color, text: s.textContent })));
      t.assert(tones.length === w.syllables.length, `${tones.length} coloured syllables for ${w.pinyin}`);
      tones.forEach((s, i) => t.assert(s.c.includes(`t${w.syllables[i].tone}`) && s.text === w.syllables[i].py, `syllable ${i}: ${JSON.stringify(s)} vs ${JSON.stringify(w.syllables[i])}`));
      const colors = await main.evaluate(() => [1, 2, 3, 4, 5].map((n) => getComputedStyle(document.documentElement).getPropertyValue(`--tone${n}`).trim()));
      t.assert(new Set(colors).size === 5, `tone colours not distinct: ${colors}`);
      const hv = await main.$('.hero .hv');
      if (verdicts.get(w.hanzi) === 'show') t.assert(hv && (await main.$eval('.hero .hv b', (b) => b.textContent.trim())) === w.hanviet, `Hán Việt "${w.hanviet}" not shown`);
      else t.assert(!hv, `Hán Việt shown for a "${verdicts.get(w.hanzi)}" verdict: ${hv && (await t.text(main, '.hero .hv'))}`);
      await main.waitForFunction((n) => document.querySelectorAll('.strokes svg path').length > 0 && document.querySelectorAll('.strokes .stroke').length === n, { timeout: 8000 }, [...w.hanzi].length);
      const chip = await main.$eval('.chips .chip', (c) => ({ text: c.textContent.trim(), href: c.getAttribute('href') }));
      t.assert(chip.text === `HSK ${w.hsk}` && chip.href === `#/hsk/${w.hsk}`, `chip ${JSON.stringify(chip)}`);
      await main.click('.chips .chip');
      await t.waitFor(main, '.page h1', `HSK ${w.hsk}`);
      const lesson = Math.floor(p[w.hsk].ids.indexOf(w.id) / 25) + 1;
      await main.type('.actions input[type=search]', w.hanzi);
      await t.waitFor(main, '.lesson summary', `Bài ${lesson}`);
      const rows = await main.$$eval('.lesson[open] .row .hz', (els) => els.map((e) => e.textContent.trim()));
      t.assert(rows.includes(w.hanzi), `word not listed under Bài ${lesson}: ${rows}`);
    });
  }

  await t.step('lesson page shows Hán Việt as written (lower case)', async () => {
    const w = cases[0][1];
    await go(`#/hsk/${w.hsk}`);
    await t.waitFor(main, '.lesson');
    await main.type('.actions input[type=search]', w.hanzi);
    await t.waitFor(main, '.lesson[open] .row .hz', w.hanzi);
    const hv = await main.$$eval('.lesson[open] a.row', (rows, h) => rows.find((r) => r.querySelector('.hz').textContent.trim() === h)?.querySelector('.hv').innerText.trim(), w.hanzi);
    t.assert(hv === w.hanviet, `Hán Việt displayed as "${hv}" (data: "${w.hanviet}")`);
  });

  await t.step('re-locked: a topic word chip for HSK 5 explains the lock', async () => {
    await go('#/settings/hsk');
    await t.click(main, '.chip', 'HSK 1–3');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json')).settings.hskOpen === 3);
    const w = t.data.words.find((x) => x.hsk === 5 && x.topics.length);
    await go(`#/word/${encodeURIComponent(w.id)}`);
    await t.waitFor(main, '.chips .chip', 'HSK 5');
    await main.click('.chips .chip');
    await t.waitFor(main, '.page .empty', 'HSK 5 đang khoá');
  });

  await t.step('re-locked: an HSK 6 pack word page is not reachable from search', async () => {
    const w = cases[2][1];
    await go(`#/word/${encodeURIComponent(w.id)}`);
    await t.waitFor(main, '.page');
    const text = await t.text(main, '.page');
    t.assert(!text.includes(w.vi), `locked HSK 6 word page still shows "${w.vi}"`);
  });
}
