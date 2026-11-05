// The assistant's bubble with the hardest HSK 4–6 content in dark mode: the longest meanings,
// meanings containing Chinese characters, and the longest words. Each must fit the bubble and the pet window.
import { readFileSync } from 'node:fs';

const pack = (l) => JSON.parse(readFileSync(`src/generated/hsk${l}.json`, 'utf8'));
const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const all = [...core.words, ...[4, 5, 6].flatMap((l) => pack(l).words)].filter((w) => w.hsk >= 4);
const han = /\p{Script=Han}/u;
const byLen = (f) => [...all].sort((a, b) => f(b) - f(a));
const targets = [...new Set([
  ...byLen((w) => w.vi.length).slice(0, 3),
  ...all.filter((w) => han.test(w.vi)),
  ...byLen((w) => [...w.hanzi].length).slice(0, 2),
  ...byLen((w) => (w.hanviet ?? '').length).slice(0, 1),
].map((w) => w.id))];
const pool = [4, 5, 6].flatMap((l) => pack(l).ids);
export const seed = {
  'settings.json': { settings: { hskOpen: 6, hsk: [4, 5, 6], topics: [], mode: 'dark', guessFirst: false, showHanviet: true, showExample: true, settingsVersion: 3, onboarded: true } },
  'progress.json': { exposure: Object.fromEntries(pool.filter((id) => !targets.includes(id)).map((id) => [id, { n: 6, t: 1, k: true }])) },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main');
  const pet = await t.open('pet');
  const seen = new Set();
  await t.waitFor(pet, '.bubble .hanzi', undefined, 10_000);

  for (let i = 0; i < targets.length + 6 && seen.size < targets.length; i++) {
    const hanzi = await t.text(pet, '.bubble .hanzi');
    const w = all.find((x) => x.hanzi === hanzi && targets.includes(x.id));
    if (w && !seen.has(w.id)) {
      seen.add(w.id);
      await t.step(`bubble ${w.hanzi} "${w.vi}"`, async () => {
        await t.waitFor(pet, '.bubble .vi', w.vi);
        const m = await pet.evaluate(() => {
          const r = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON();
          const clipped = [...document.querySelectorAll('.bubble *')].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
            .map((el) => el.className);
          return { bubble: r('.bubble'), vi: r('.bubble .vi'), hanzi: r('.bubble .hanzi'), vw: innerWidth, vh: innerHeight, clipped, pos: window.__e2e.windowPos ?? null };
        });
        const inside = (b) => b && b.left >= 0 && b.top >= 0 && b.right <= m.vw && b.bottom <= m.vh;
        t.assert(inside(m.bubble), `bubble ${JSON.stringify(m.bubble)} outside the ${m.vw}x${m.vh} window`);
        t.assert(m.vi.left >= m.bubble.left && m.vi.right <= m.bubble.right && m.vi.bottom <= m.bubble.bottom, `meaning ${JSON.stringify(m.vi)} spills out of the bubble`);
        t.assert(m.hanzi.left >= m.bubble.left && m.hanzi.right <= m.bubble.right, `word ${JSON.stringify(m.hanzi)} spills out of the bubble`);
        t.assert(!m.clipped.length, `clipped text: ${m.clipped}`);
        if (w.hanviet) await t.waitFor(pet, '.bubble .hv', w.hanviet);
        const hv = await pet.$('.bubble .hv');
        t.assert(!!hv === !!w.hanviet, `Hán Việt line shown=${!!hv} for ${w.hanviet ?? 'none'}`);
      });
      // Only six new words are in rotation at once; marking each known lets the next one in.
      await pet.bringToFront();
      await t.click(pet, '.actions button', 'Biết rồi');
      await pet.waitForFunction((id) => JSON.parse(localStorage.getItem('e2e:store:progress.json') ?? '{}').exposure?.[id]?.k, { timeout: 3000 }, w.id);
    }
    await t.emitTo(main, 'pet', 'tray:command', 'next');
    await pet.waitForFunction((h) => {
      const el = document.querySelector('.bubble .hanzi');
      return el && el.textContent.trim() !== h && !document.querySelector('.content.out');
    }, { timeout: 5000 }, hanzi);
  }

  await t.step('every hard word came up', async () => {
    const missing = targets.filter((id) => !seen.has(id));
    t.assert(!missing.length, `never shown: ${missing}`);
  });

  await t.step('pet window stays on the 1920x1040 work area', async () => {
    const calls = await t.calls(pet, 'plugin:window|set_position');
    const size = await pet.evaluate(() => window.__e2e.windowSize);
    const last = calls.at(-1)?.args?.value;
    const pos = last?.Physical ?? last?.Logical ?? last;
    t.assert(!pos || (pos.x >= 0 && pos.y >= 0 && pos.x + size.width <= 1920 && pos.y + size.height <= 1040), `window at ${JSON.stringify(pos)} size ${JSON.stringify(size)}`);
  });
}
