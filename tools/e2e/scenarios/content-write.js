// Writing practice on an HSK 6 lesson: stroke data loads for every character, the demo and the
// stroke hint redraw the board, and drawing each stroke along its median completes every word.
import { readFileSync } from 'node:fs';

export const seed = { 'settings.json': { settings: { hskEdition: 2021, hskOpen: 6, hsk: [1], settingsVersion: 3, onboarded: true, writeDemo: false } } };
const strokes = (ch) => JSON.parse(readFileSync(`public/strokes/${ch}.json`, 'utf8'));
const isHan = (c) => /\p{Script=Han}/u.test(c);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/write/hsk/6/1');
  const lesson = new Set(t.packs[6].ids.slice(0, 25));
  /** Stroke files the page fetched, by character: HTTP status from resource timing. */
  const strokeStatus = () => main.evaluate(() => Object.fromEntries(performance.getEntriesByType('resource')
    .map((e) => [decodeURIComponent(e.name).match(/\/strokes\/(.+)\.json$/)?.[1], e.responseStatus]).filter(([c]) => c)));
  const svgHtml = () => main.$eval('.board svg', (s) => s.innerHTML);
  /** Resolves once the board stops changing for `quiet` ms. */
  async function settle(quiet = 700, max = 15_000) {
    let last = await svgHtml(), since = Date.now();
    const start = Date.now();
    while (Date.now() - start < max) {
      await new Promise((r) => setTimeout(r, 100));
      const now = await svgHtml();
      if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= quiet) return;
    }
  }
  async function draw(ch) {
    const box = await (await main.$('.board svg')).boundingBox();
    const size = 300, padding = 6, scale = (size - 2 * padding) / 1024;
    const xOff = padding, yOff = 124 * scale + padding;
    for (const median of strokes(ch).medians) {
      const pts = median.map(([x, y]) => ({ x: box.x + x * scale + xOff, y: box.y + size - yOff - y * scale }));
      await main.mouse.move(pts[0].x, pts[0].y);
      await main.mouse.down();
      for (const p of pts.slice(1)) await main.mouse.move(p.x, p.y, { steps: 3 });
      await main.mouse.up();
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  await t.step('board loads stroke data for an HSK 6 word', async () => {
    await t.waitFor(main, '.lead', 'HSK 6 · Bài 1');
    await main.waitForSelector('.board svg path', { timeout: 8000 });
    const hanzi = (await t.text(main, '.target .word')).replace(/\s/g, '');
    // A 2021 HSK 6 word can ship in pack 4 or 5 when the 2025 lists put it lower.
    const all = [...t.packs[4].words, ...t.packs[5].words, ...t.packs[6].words, ...t.data.words];
    const w = all.find((x) => x.hanzi === hanzi && lesson.has(x.id)) ?? all.find((x) => x.hanzi === hanzi);
    t.assert(w && lesson.has(w.id), `word ${hanzi} is not in HSK 6 lesson 1`);
    t.assert((await t.text(main, '.target .vi')) === w.vi, 'meaning next to the board');
  });

  await t.step('"Xem mẫu" plays the stroke order', async () => {
    await settle();
    const before = await svgHtml();
    await t.click(main, '.tools .btn', 'Xem mẫu');
    await new Promise((r) => setTimeout(r, 400));
    t.assert((await svgHtml()) !== before, 'board did not change after "Xem mẫu"');
    // The demo pauses 700 ms after the last stroke before the board hides and the quiz starts.
    await settle(1500);
  });

  await t.step('"Gợi ý nét" highlights the next stroke', async () => {
    await main.evaluate(() => {
      window.__mut = 0;
      new MutationObserver((m) => { window.__mut += m.length; }).observe(document.querySelector('.board svg'), { subtree: true, attributes: true, childList: true });
    });
    await t.click(main, '.tools .btn', 'Gợi ý nét');
    await new Promise((r) => setTimeout(r, 400));
    const mut = await main.evaluate(() => window.__mut);
    t.assert(mut > 0, `board did not change after "Gợi ý nét" (${mut} mutations)`);
    await settle();
  });

  for (let n = 1; n <= 12; n++) {
    const hanzi = (await t.text(main, '.target .word'))?.replace(/\s/g, '');
    if (!hanzi) break;
    await t.step(`word ${n}: ${hanzi}`, async () => {
      const chars = [...hanzi].filter(isHan);
      for (const ch of chars) {
        await main.waitForSelector('.board svg path', { timeout: 8000 });
        await draw(ch);
        await t.waitFor(main, '.result b', 'Không sai nét nào', 8000);
        await t.click(main, '.result .btn', 'Tiếp');
      }
      const status = await strokeStatus();
      for (const ch of chars) t.assert(status[ch] === 200 || status[ch] === 304, `stroke file for ${ch}: ${status[ch] ?? 'never requested'}`);
    });
  }

  await t.step('session ends with a summary', async () => {
    await t.waitFor(main, '.done h2', 'tổng cộng sai 0 nét');
  });
}
