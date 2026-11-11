// Skin: picking a border skin in Settings swaps the character for a border around the bubble, and turning Skin off
// leaves a plain bubble. The size row applies to the character only.
import { readFileSync } from 'node:fs';

const { pad } = JSON.parse(readFileSync('src/pet/frames/meadow.json', 'utf8'));
const LEAF_MARGIN = pad.top + pad.bottom;

export const seed ={ 'settings.json': { settings: { settingsVersion: 5, onboarded: true, wordSec: 60, guessFirst: false, topics: ['greetings'], hsk: [] } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/settings');
  const pet = await t.open('pet');
  const look = () => pet.evaluate(() => ({
    character: !!document.querySelector('.sprite-slot'),
    frame: document.querySelector('.frame .skin')?.firstElementChild?.className ?? null,
    tail: getComputedStyle(document.querySelector('.bubble .tail')).display,
    width: window.__e2e.windowSize?.width,
  }));
  const pick = async (label) => {
    await main.bringToFront();
    await t.click(main, '.select-trigger', 'Trợ lý');
    await t.waitFor(main, '[role="option"]', label);
    await t.click(main, '[role="option"]', label);
    await pet.bringToFront();
  };
  const sizeDisabled = () => main.evaluate(() => [...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Cỡ trợ lý'))
    .querySelector('.chip').disabled);

  await t.step('default skin: the character beside the bubble, with the tail', async () => {
    await pet.bringToFront();
    await t.waitFor(pet, '.bubble .hanzi', undefined, 10_000);
    const l = await look();
    t.assert(l.character && !l.frame && l.tail !== 'none', `start ${JSON.stringify(l)}`);
    t.assert(!(await sizeDisabled()), 'size row disabled with the character skin');
  });

  let widthWithCharacter = 0;
  await t.step('Viền hoa lá: no character, a border, no tail, a narrower window', async () => {
    widthWithCharacter = (await look()).width;
    await pick('Viền hoa lá');
    await pet.waitForFunction(() => !document.querySelector('.sprite-slot') && document.querySelector('.frame'), { timeout: 5000 });
    const l = await look();
    t.assert(l.tail === 'none' && l.width < widthWithCharacter, `leaf ${JSON.stringify(l)} vs width ${widthWithCharacter}`);
    // The leaf skin's margin above and below the bubble must reach the window height while the bubble stays.
    await pet.waitForFunction((margin) => {
      const b = document.querySelector('.bubble-slot');
      return b && window.__e2e.windowSize?.height >= b.offsetHeight + margin;
    }, { timeout: 5000 }, LEAF_MARGIN).catch(() => {});
    const fit = await pet.evaluate(() => ({ win: window.__e2e.windowSize?.height, bubble: document.querySelector('.bubble-slot').offsetHeight }));
    t.assert(fit.win >= fit.bubble + LEAF_MARGIN, `leaf window ${fit.win}px tall for a ${fit.bubble}px bubble`);
    const saved = (await t.store(main, 'settings.json')).settings;
    t.assert(saved.petSkin === 'leaf' && saved.petSkinOn === true, `saved ${JSON.stringify({ skin: saved.petSkin, on: saved.petSkinOn })}`);
    t.assert(await sizeDisabled(), 'size row still enabled without the character');
  });

  await t.step('Viền hoa lá: a pointer passing over the plants brushes them, a click there shows the next word', async () => {
    await pet.bringToFront();
    // The plants take the pointer: their visible parts are reported as hit rects next to the bubble's.
    await pet.waitForFunction(() => (window.__e2e.hitRects ?? []).length > 3, { timeout: 5000 }).catch(() => {});
    const spot = await pet.evaluate(() => {
      const bubble = document.querySelector('.bubble').getBoundingClientRect();
      for (const el of document.querySelectorAll('.frame .hit')) {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2, y = Math.max(r.y + 2, bubble.bottom + 6);
        if (y < r.bottom - 2 && document.elementFromPoint(x, y) === el) return { x, y, rects: window.__e2e.hitRects?.length ?? 0 };
      }
      return null;
    });
    t.assert(spot, 'no plant takes the pointer below the bubble');
    t.assert(spot.rects > 3, `only ${spot.rects} hit rects reported: the plants are not clickable`);
    const pose = () => pet.evaluate(() => [...document.querySelectorAll('.frame g.sprite')].map((g) => g.getAttribute('transform')).join('|'));
    const rest = await pose();
    await pet.mouse.move(spot.x - 50, spot.y);
    await pet.mouse.move(spot.x + 50, spot.y, { steps: 10 });
    const brushed = await pet.waitForFunction((r) => [...document.querySelectorAll('.frame g.sprite')].map((g) => g.getAttribute('transform')).join('|') !== r,
      { timeout: 2000 }, rest).then(() => true, () => false);
    t.assert(brushed, 'passing the pointer over the plants did not move them');
    console.log(`      brushed: ${(await pose()).split('|').filter((s) => !/skewX\(0(\.00)?\)/.test(s)).length} plants leaning`);
    const word = await pet.$eval('.bubble .hanzi', (e) => e.textContent);
    await pet.mouse.click(spot.x, spot.y);
    const next = await pet.waitForFunction((w) => document.querySelector('.bubble .hanzi')?.textContent !== w, { timeout: 5000 }, word).then(() => true, () => false);
    t.assert(next, `a click on the plants kept the word ${word}`);
  });

  await t.step('Skin off from the sidebar: a plain bubble, and the skin list greys out', async () => {
    await main.bringToFront();
    await t.click(main, '.pet-toggle', 'Skin');
    await pet.bringToFront();
    await pet.waitForFunction(() => !document.querySelector('.frame') && !document.querySelector('.sprite-slot'), { timeout: 5000 });
    const l = await look();
    t.assert(!l.character && !l.frame && l.tail === 'none', `off ${JSON.stringify(l)}`);
    t.assert(await main.$eval('.select-trigger', (b) => b.disabled), 'skin list enabled with Skin off');
    t.assert((await t.store(main, 'settings.json')).settings.petSkin === 'leaf', 'Skin off forgot the chosen skin');
  });

  await t.step('Skin on again from the pet menu: the border comes back', async () => {
    await pet.click('.bubble-slot', { button: 'right' });
    await t.waitFor(pet, '.menu button', 'Bật Skin');
    await t.click(pet, '.menu button', 'Bật Skin');
    await pet.waitForFunction(() => document.querySelector('.frame') && !document.querySelector('.sprite-slot'), { timeout: 5000 });
  });
}
