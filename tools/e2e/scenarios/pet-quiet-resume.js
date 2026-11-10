// Quiet hours: she sleeps and the menu offers "Tiếp tục". Resuming keeps her awake for the rest of that quiet
// window: words keep coming instead of one word and back to sleep. Pausing again puts her back to sleep.
// The quiet window is set around the time the scenario runs (local time, as the app reads it).
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const now = Date.now();
export const seed = {
  'settings.json': { settings: {
    settingsVersion: 5, onboarded: true, petSkinOn: false, wordSec: 8, guessFirst: false, topics: ['greetings'], hsk: [],
    quietEnabled: true, quietFrom: hhmm(new Date(now - 60 * 60_000)), quietTo: hhmm(new Date(now + 60 * 60_000)),
  } },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  await pet.bringToFront();
  const menuItems = async () => {
    await pet.click('.bubble-slot', { button: 'right' });
    await t.waitFor(pet, '.menu');
    const items = await t.texts(pet, '.menu button');
    // The open menu covers the bubble; it closes when the window loses focus, as when the user clicks elsewhere.
    await pet.evaluate(() => window.dispatchEvent(new Event('blur')));
    await pet.waitForFunction(() => !document.querySelector('.menu'), { timeout: 3000 });
    await awayFromBubble();
    return items;
  };
  // A pointer resting on the bubble holds the word on purpose: move it off before waiting for the next words.
  const awayFromBubble = () => pet.mouse.move(1, 1);

  await t.step('quiet hours: asleep, and the menu offers "Tiếp tục"', async () => {
    await t.waitFor(pet, '.nap', 'Đang tạm dừng', 10_000);
    const items = await menuItems();
    t.assert(items.some((x) => x.includes('Tiếp tục')) && !items.some((x) => x.includes('Tạm dừng 30 phút')), `menu ${items}`);
  });

  await t.step('"Tiếp tục" keeps her awake through the next turns', async () => {
    await pet.click('.bubble-slot', { button: 'right' });
    await t.click(pet, '.menu button', 'Tiếp tục');
    await awayFromBubble();
    await t.waitFor(pet, '.bubble .hanzi', undefined, 5000);
    const first = await t.text(pet, '.bubble .hanzi');
    // wordSec is 8: two turns later she must still be showing words, not asleep, and a new word has come.
    await pet.evaluate(() => new Promise((r) => setTimeout(r, 18_000)));
    t.assert(!(await pet.$('.nap')), 'she went back to sleep after one word');
    t.assert((await t.text(pet, '.bubble .hanzi')) !== first, `still the first word ${first} after two turns`);
    t.assert(await pet.$('.bubble .hanzi'), 'no word shown');
    console.log(`      words: ${first} … ${await t.text(pet, '.bubble .hanzi')}`);
    const items = await menuItems();
    t.assert(items.some((x) => x.includes('Tạm dừng 30 phút')), `menu while resumed ${items}`);
  });

  await t.step('pausing again puts her to sleep', async () => {
    await pet.click('.bubble-slot', { button: 'right' });
    await t.click(pet, '.menu button', 'Tạm dừng 30 phút');
    await t.waitFor(pet, '.nap', 'Đang tạm dừng', 5000);
  });
}
