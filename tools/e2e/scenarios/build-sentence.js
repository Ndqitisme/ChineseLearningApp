// Sentence building: tiles in the right order score 100 and show the reference sentence;
// a wrong order scores less and marks the misplaced tiles.
const SEPARATORS = /[\s，。？！、；：,.?!;:“”"'（）()…—~]+/g;

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/build/order/topic/greetings');
  const poolTiles = () => main.$$eval('.pool .tile', (ts) => ts.map((x) => ({ text: x.innerText.trim(), used: x.disabled })));

  /** Clicks pool tiles so they spell `target` from left to right. */
  async function spell(target) {
    let rest = target.replace(SEPARATORS, '');
    while (rest) {
      const tiles = await poolTiles();
      const i = tiles.findIndex((x) => !x.used && rest.startsWith(x.text));
      t.assert(i >= 0, `no tile continues "${rest}" (tiles: ${tiles.map((x) => x.text)})`);
      await (await main.$$('.pool .tile'))[i].click();
      rest = rest.slice(tiles[i].text.length);
    }
  }
  const sentenceFor = async () => {
    const prompt = (await t.text(main, '.ask b')).replace(/^“|”$/g, '');
    const w = t.data.words.find((x) => x.ex?.vi === prompt);
    t.assert(w, `no example sentence means "${prompt}"`);
    return w.ex.zh;
  };

  await t.step('right order scores 100', async () => {
    await t.waitFor(main, '.pool .tile');
    const zh = await sentenceFor();
    await spell(zh);
    await t.click(main, 'button', 'Kiểm tra');
    await t.waitFor(main, '.points', '100');
    const ref = await t.text(main, '.reference .ref-zh');
    t.assert(ref === zh, `reference "${ref}", expected "${zh}"`);
  });

  await t.step('next sentence', async () => {
    await t.click(main, 'button', 'Tiếp');
    await t.waitFor(main, '.count', 'Câu 2/');
  });

  await t.step('wrong order scores less', async () => {
    const zh = (await sentenceFor()).replace(SEPARATORS, '');
    const tiles = await poolTiles();
    // Pick tiles right to left; only fall back to another order if that happens to spell it.
    const handles = await main.$$('.pool .tile');
    const order = [...tiles.keys()].reverse();
    if (order.map((i) => tiles[i].text).join('') === zh) order.push(order.shift());
    for (const i of order) await handles[i].click();
    await main.keyboard.press('Enter');
    await t.waitFor(main, '.points');
    const pts = Number(await t.text(main, '.points b'));
    t.assert(pts < 100, `a wrong order scored ${pts}`);
    t.assert(await main.$('.answer .tile.off'), 'misplaced tiles are not marked');
  });
}
