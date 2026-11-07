// The assistant counts only showings someone could see. A fullscreen app already open at start-up keeps her
// hidden even though its event went out before she listened; tray "next" while hidden records nothing; when it
// closes she comes back by herself. With the user away (idle over a minute) words still change but do not count.
// Only the pet window is open: a main window left idle in the background never yields a screenshot.
export const seed = {
  'settings.json': { settings: { settingsVersion: 4, onboarded: true, wordSec: 8, guessFirst: false, idlePauseMin: 10, topics: ['greetings'], hsk: [] } },
};
export const system = { busy: true };

const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
const exposure = async (t, page) => (await t.store(page, 'progress.json')).exposure ?? {};
const total = (e) => Object.values(e).reduce((s, x) => s + (x.n ?? 0), 0);
const totalIn = () => Object.values(JSON.parse(localStorage.getItem('e2e:store:progress.json') ?? '{}').exposure ?? {})
  .reduce((s, x) => s + (x.n ?? 0), 0);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  await pet.bringToFront();

  await t.step('fullscreen app open at start-up: she stays hidden', async () => {
    await wait(pet, 3000);
    t.assert(!(await t.calls(pet, 'plugin:window|show')).length, 'pet window was shown under a fullscreen app');
  });

  await t.step('tray "next" while hidden records nothing', async () => {
    await t.emitTo(pet, 'pet', 'tray:command', 'next');
    await wait(pet, 2500);
    t.assert(total(await exposure(t, pet)) === 0, `exposure recorded while hidden: ${JSON.stringify(await exposure(t, pet))}`);
    t.assert(!(await t.calls(pet, 'plugin:window|show')).length, 'tray "next" showed the hidden window');
  });

  await t.step('the fullscreen app closes: she comes back without its event, and the word counts', async () => {
    await pet.evaluate(() => { window.__e2e.system.busy = false; });
    await pet.waitForFunction(() => window.__e2e.calls.some((c) => c.cmd === 'plugin:window|show'), { timeout: 12_000 });
    await t.waitFor(pet, '.bubble .hanzi', undefined, 10_000);
    await pet.waitForFunction(new Function(`return (${totalIn})() === 1`), { timeout: 5000 });
  });

  await t.step('user away: the word changes but does not count', async () => {
    await pet.evaluate(() => { window.__e2e.system.idleSecs = 120; });
    const before = total(await exposure(t, pet));
    const word = await t.text(pet, '.bubble .hanzi');
    await pet.waitForFunction((h) => {
      const el = document.querySelector('.bubble .hanzi');
      return el && el.textContent.trim() !== h && !document.querySelector('.content.out');
    }, { timeout: 15_000 }, word);
    t.assert(total(await exposure(t, pet)) === before, `away showings counted: ${before} → ${total(await exposure(t, pet))}`);
  });

  await t.step('user back: the next word counts again', async () => {
    await pet.evaluate(() => { window.__e2e.system.idleSecs = 0; });
    const before = total(await exposure(t, pet));
    await pet.waitForFunction(new Function('n', `return (${totalIn})() > n`), { timeout: 15_000 }, before);
  });
}
