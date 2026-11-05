// The assistant shows a word in its bubble, records the exposure, swaps to another word on the
// tray's "next", and clicking the word opens it in the main window.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main');
  const pet = await t.open('pet');
  const byHanzi = (h) => t.data.words.find((w) => w.hanzi === h);

  let first;
  await t.step('bubble shows a word', async () => {
    await t.waitFor(pet, '.bubble .hanzi', undefined, 10_000);
    first = await t.text(pet, '.bubble .hanzi');
    const word = byHanzi(first);
    t.assert(word, `bubble word ${first} is not in the dataset`);
    await t.waitFor(pet, '.bubble .vi', word.vi);
    t.assert((await t.calls(pet, 'plugin:window|show')).length === 1, 'pet window was not shown');
    const rects = await pet.evaluate(() => window.__e2e.hitRects);
    t.assert(rects?.length >= 2, `click-through rects for sprite and bubble: ${JSON.stringify(rects)}`);
  });

  await t.step('exposure is recorded', async () => {
    const id = byHanzi(first).id;
    await pet.waitForFunction((k) => JSON.parse(localStorage.getItem('e2e:store:progress.json') ?? '{}').exposure?.[k]?.n === 1, {}, id);
  });

  await t.step('tray "next" swaps the word', async () => {
    await t.emitTo(main, 'pet', 'tray:command', 'next');
    await pet.waitForFunction((h) => {
      const el = document.querySelector('.bubble .hanzi');
      return el && el.textContent.trim() !== h && !document.querySelector('.content.out');
    }, { timeout: 5000 }, first);
    t.assert(byHanzi(await t.text(pet, '.bubble .hanzi')), 'second word is not in the dataset');
  });

  await t.step('clicking the word opens it in the main window', async () => {
    const hanzi = await t.text(pet, '.bubble .hanzi');
    await pet.click('.bubble .hanzi');
    const calls = await t.calls(pet, 'open_main');
    t.assert(calls.at(-1)?.args.route === `/word/${encodeURIComponent(byHanzi(hanzi).id)}`, `open_main ${JSON.stringify(calls.at(-1))}`);
    await main.waitForFunction((h) => decodeURIComponent(location.hash) === `#/word/${h}`, { timeout: 3000 }, byHanzi(hanzi).id);
    await t.waitFor(main, '.page', hanzi);
  });
}
