// The TieuMai Kai extension font (HSK 4–6 characters only) loads only when such a character is on
// screen, and HSK 4–6 characters are actually drawn with it, not with a system fallback.
import { readFileSync } from 'node:fs';

const ext = new Set([...readFileSync('.cache/charset-ext.txt', 'utf8')].filter((c) => /\p{Script=Han}/u.test(c)));
export const seed = { 'settings.json': { settings: { hskOpen: 6, hsk: [1], settingsVersion: 3, onboarded: true } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const fontFiles = () => main.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/fonts/')).map((n) => n.split('/').pop()));
  const cdp = await main.createCDPSession();
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  /** Fonts Chrome actually used to draw the text of the first `selector` match. */
  async function platformFonts(selector) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts;
  }

  await t.step('home and course list (HSK 1–3 text only) do not fetch the extension font', async () => {
    await main.waitForNetworkIdle({ idleTime: 400 });
    await go('#/topics');
    await t.waitFor(main, '.page h1');
    await main.waitForNetworkIdle({ idleTime: 400 });
    const files = await fontFiles();
    t.assert(!files.includes('TieuMaiKai-ext.woff2'), `extension font fetched on HSK 1–3 pages: ${files}`);
  });

  // A word the HSK 6 course lists under the default (2025) edition; the pack a word ships in follows its lowest
  // level in either edition, so look it up across all packs.
  const course6 = new Set(t.packs[6].ids2025);
  const all = [...t.data.words, ...t.packs[4].words, ...t.packs[5].words, ...t.packs[6].words];
  const word = all.find((w) => course6.has(w.id) && [...w.hanzi].every((c) => ext.has(c)) && w.hanzi.length >= 2);
  await t.step(`HSK 6 word ${word.hanzi} on its course page draws with TieuMai Kai`, async () => {
    await go(`#/hsk/6`);
    await t.waitFor(main, '.lesson');
    await main.type('.actions input[type=search]', word.hanzi);
    await t.waitFor(main, '.lesson[open] .row .hz', word.hanzi);
    await main.evaluate(() => document.fonts.ready);
    await main.waitForNetworkIdle({ idleTime: 300 });
    t.assert((await fontFiles()).includes('TieuMaiKai-ext.woff2'), 'extension font not fetched for an HSK 6 word');
    const sel = [...(await main.$$('.lesson[open] .row .hz'))];
    let idx = 0;
    for (const [i, el] of sel.entries()) if ((await el.evaluate((e) => e.textContent.trim())) === word.hanzi) idx = i;
    await main.evaluate((i) => document.querySelectorAll('.lesson[open] .row .hz')[i].setAttribute('data-font-probe', ''), idx);
    const fonts = await platformFonts('[data-font-probe]');
    const family = await main.$eval('[data-font-probe]', (e) => getComputedStyle(e).fontFamily);
    t.assert(family.includes('TieuMai Kai'), `computed font-family ${family}`);
    t.assert(fonts.length === 1 && fonts[0].isCustomFont && fonts[0].glyphCount === [...word.hanzi].length,
      `drawn with ${JSON.stringify(fonts)}`);
  });

  await t.step('Han characters across the whole HSK 6 page draw with TieuMai Kai', async () => {
    await go('#/topics');
    await t.waitFor(main, '.topic');
    await go('#/hsk/6');
    await t.waitFor(main, '.lesson');
    await main.evaluate(() => document.querySelectorAll('.lesson').forEach((d) => { d.open = true; }));
    await main.evaluate(() => document.fonts.ready);
    const n = await main.$$eval('.lesson .row .hz', (els) => { els.forEach((e, i) => e.setAttribute('data-hz', String(i))); return els.length; });
    t.assert(n > 1000, `only ${n} rows on the HSK 6 page`);
    const bad = [];
    for (let i = 0; i < n; i += 37) {
      const fonts = await platformFonts(`[data-hz="${i}"]`);
      if (!fonts.length || fonts.some((f) => !f.isCustomFont)) bad.push(`${i}: ${JSON.stringify(fonts)}`);
    }
    t.assert(!bad.length, `system fallback used: ${bad.slice(0, 5)}`);
  });
}
