// HSK 4–6 surfaces at the minimum (860x600) and default (1120x760) window sizes, light and dark:
// no horizontal scroll, nothing pokes out of the window, and text keeps contrast.
import { mkdirSync } from 'node:fs';

export const seed = { 'settings.json': { settings: { hskOpen: 6, hsk: [1], settingsVersion: 3, onboarded: true, mode: 'light' } } };
const SIZES = [{ width: 860, height: 600 }, { width: 1120, height: 760 }];
const PAGES = ['#/topics', '#/hsk/5', '#/quiz/meaning/hsk/6/1', '#/quiz/hanzi/hsk/4/3', '#/word/激烈', '#/word/嘴巴', '#/word/一般来说', '#/write/hsk/6/2', '#/tones/hsk/4', '#/search/lihai', '#/settings/hsk'];
const OUT = '.cache/e2e/content-layout/pages';

/** @param {import('../run.ts').T} t */
export default async function (t) {
  mkdirSync(OUT, { recursive: true });
  const main = await t.open('main');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);

  for (const mode of ['light', 'dark']) {
    if (mode === 'dark') {
      await main.evaluate(() => {
        const k = 'e2e:store:settings.json';
        const s = JSON.parse(localStorage.getItem(k));
        s.settings.mode = 'dark';
        localStorage.setItem(k, JSON.stringify(s));
      });
      await t.reload('main');
    }
    for (const size of SIZES) {
      await t.step(`${mode} ${size.width}x${size.height}`, async () => {
        await main.setViewport(size);
        const bad = [];
        for (const hash of PAGES) {
          await go('#/about');
          await t.waitFor(main, '.page');
          await go(hash);
          await t.waitFor(main, '.page .card, .page .lesson, .page .search');
          await main.evaluate(() => document.fonts.ready);
          await new Promise((r) => setTimeout(r, 250));
          const r = await main.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const sticking = [...document.querySelectorAll('.page *')].filter((el) => {
              const b = el.getBoundingClientRect();
              return b.width && b.right > vw + 1 && getComputedStyle(el).position !== 'fixed';
            }).slice(0, 3).map((el) => `${el.tagName}.${el.className}`);
            const bg = getComputedStyle(document.body).backgroundColor;
            const fg = getComputedStyle(document.querySelector('.page .card, .page h1') ?? document.body).color;
            return { scroll: document.documentElement.scrollWidth > vw, sticking, bg, fg, dark: document.documentElement.dataset.mode ?? document.documentElement.className };
          });
          const name = hash.replace(/[#/]+/g, '_');
          await main.screenshot({ path: `${OUT}/${mode}-${size.width}x${size.height}${name}.png` });
          if (r.scroll || r.sticking.length) bad.push(`${hash}: scroll=${r.scroll} ${r.sticking}`);
          if (r.bg === r.fg) bad.push(`${hash}: heading colour equals background ${r.bg}`);
        }
        t.assert(!bad.length, bad.join(' | '));
      });
    }
  }

  await t.step('a word opened from far down an HSK course starts at the top', async () => {
    await go('#/hsk/6');
    await t.waitFor(main, '.lesson');
    await main.evaluate(() => { const l = [...document.querySelectorAll('.lesson')].at(-1); l.open = true; l.scrollIntoView(); });
    const before = await main.evaluate(() => [...document.querySelectorAll('*')].map((e) => e.scrollTop).reduce((a, b) => Math.max(a, b), 0));
    await main.evaluate(() => [...document.querySelectorAll('.lesson')].at(-1).querySelector('a.row').click());
    await t.waitFor(main, '.hero .vi');
    const after = await main.evaluate(() => {
      const h = document.querySelector('.hero').getBoundingClientRect();
      return { top: h.top, bottom: h.bottom, vh: innerHeight };
    });
    t.assert(before > 1000, `course page did not scroll (${before})`);
    t.assert(after.top >= 0 && after.top < after.vh, `word page opened scrolled: hero at ${after.top}px (window ${after.vh}px)`);
  });

  await t.step('the "Chủ đề" link in Settings › Khoá học HSK opens the course list at its top', async () => {
    await main.setViewport({ width: 860, height: 600 });
    await go('#/settings/hsk');
    await t.waitFor(main, '#hsk');
    await main.evaluate(() => [...document.querySelectorAll('.page a[href="#/topics"]')].at(-1).click());
    await t.waitFor(main, '.topic');
    const top = await main.$eval('.page h1', (h) => h.getBoundingClientRect().top);
    t.assert(top >= 0, `course list opened scrolled: its heading is ${Math.round(-top)}px above the window`);
  });
}
