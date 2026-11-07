// Pet window layout at size Lớn: the right-click menu stays inside the window, and the click-through rects follow
// the bubble when the example line is switched on from the main window (the bubble and the window grow).
import { readFileSync } from 'node:fs';

const HOST = '合同'; // business topic word with an example sentence; every other business word is marked known
const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const others = core.topics.find((x) => x.id === 'business').words.filter((id) => id !== HOST);
export const seed = {
  'settings.json': { settings: { settingsVersion: 4, onboarded: true, petScale: 4, wordSec: 60, guessFirst: false, showExample: false, topics: ['business'], hsk: [] } },
  'progress.json': { exposure: Object.fromEntries(others.map((id) => [id, { n: 6, t: 1, k: 1 }])) },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/settings');
  const pet = await t.open('pet');
  await pet.bringToFront();
  /** The bubble's reported click-through rect, and the rect it should be (Pet.svelte reportHitRects). */
  const bubbleRects = () => pet.evaluate(() => {
    const r = document.querySelector('.bubble-slot').getBoundingClientRect();
    const want = { x: r.x - 4, y: r.y - 4, w: r.width + 8, h: r.height + 14 };
    const near = (a, b) => Math.abs(a - b) < 1.5;
    const got = (window.__e2e.hitRects ?? []).find((h) => near(h.x, want.x) && near(h.w, want.w));
    return { want, got, match: !!got && near(got.y, want.y) && near(got.h, want.h) };
  });

  await t.step('the bubble shows the host word', async () => {
    await t.waitFor(pet, '.bubble .hanzi', undefined, 10_000);
    // A rare roll shows a known word first; tray next moves on.
    for (let i = 0; i < 6 && (await t.text(pet, '.bubble .hanzi')) !== HOST; i++) {
      await t.emitTo(main, 'pet', 'tray:command', 'next');
      await pet.evaluate(() => new Promise((r) => setTimeout(r, 1800)));
    }
    t.assert((await t.text(pet, '.bubble .hanzi')) === HOST, 'bubble shows ' + (await t.text(pet, '.bubble .hanzi')));
    await pet.waitForFunction(() => window.__e2e.hitRects?.length >= 2, { timeout: 5000 });
  });

  await t.step('the right-click menu fits inside the window at size Lớn', async () => {
    await pet.click('.sprite-slot', { button: 'right' });
    await t.waitFor(pet, '.menu');
    await pet.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    const box = await pet.evaluate(() => {
      const m = document.querySelector('.menu').getBoundingClientRect();
      const s = document.querySelector('.stage').getBoundingClientRect();
      return { top: m.top - s.top, bottom: s.bottom - m.bottom, stageH: s.height };
    });
    t.assert(box.top >= 0 && box.bottom >= 0, `menu cut off: ${JSON.stringify(box)}`);
    await pet.click('.sprite-slot', { button: 'right' });
    await pet.waitForFunction(() => !document.querySelector('.menu'), { timeout: 3000 });
  });

  await t.step('turning on the example line: the click-through rect follows the taller bubble', async () => {
    const before = await bubbleRects();
    t.assert(before.match, `rects before ${JSON.stringify(before)}`);
    await main.bringToFront();
    await t.click(main, 'label', 'Hiện câu ví dụ trong bong bóng');
    await pet.bringToFront();
    await t.waitFor(pet, '.bubble .ex .han');
    await pet.waitForFunction((h) => document.querySelector('.bubble-slot').getBoundingClientRect().height > h + 10, { timeout: 5000 }, before.want.h - 14);
    await pet.waitForFunction(() => {
      const r = document.querySelector('.bubble-slot').getBoundingClientRect();
      const near = (a, b) => Math.abs(a - b) < 1.5;
      return (window.__e2e.hitRects ?? []).some((h) => near(h.x, r.x - 4) && near(h.y, r.y - 4) && near(h.w, r.width + 8) && near(h.h, r.height + 14));
    }, { timeout: 5000 }).catch(async () => t.assert(false, `stale rects ${JSON.stringify(await bubbleRects())}`));
  });
}
