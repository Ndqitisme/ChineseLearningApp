// Skin: picking a border skin in Settings swaps the character for a border around the bubble, and turning Skin off
// leaves a plain bubble. The size row applies to the character only.
export const seed = { 'settings.json': { settings: { settingsVersion: 5, onboarded: true, wordSec: 60, guessFirst: false, topics: ['greetings'], hsk: [] } } };

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
  await t.step('Viền cỏ lá: no character, a border, no tail, a narrower window', async () => {
    widthWithCharacter = (await look()).width;
    await pick('Viền cỏ lá');
    await pet.waitForFunction(() => !document.querySelector('.sprite-slot') && document.querySelector('.frame'), { timeout: 5000 });
    const l = await look();
    t.assert(l.tail === 'none' && l.width < widthWithCharacter, `leaf ${JSON.stringify(l)} vs width ${widthWithCharacter}`);
    const saved = (await t.store(main, 'settings.json')).settings;
    t.assert(saved.petSkin === 'leaf' && saved.petSkinOn === true, `saved ${JSON.stringify({ skin: saved.petSkin, on: saved.petSkinOn })}`);
    t.assert(await sizeDisabled(), 'size row still enabled without the character');
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
