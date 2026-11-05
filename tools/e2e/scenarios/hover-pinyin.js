// Hovering a Chinese word that shows no pinyin pops a tooltip with its pinyin and meaning;
// moving onto Vietnamese text hides it.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main');
  /** Viewport centre of character `i` of the first text node in `selector`. */
  const charCentre = (selector, i) => main.$eval(selector, (el, n) => {
    const node = [...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
    const r = document.createRange();
    r.setStart(node, n);
    r.setEnd(node, n + 1);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, i);

  let greeting;
  await t.step('tooltip over the greeting', async () => {
    await t.waitFor(main, '.page h1 .zh');
    greeting = (await t.text(main, '.page h1 .zh')).replace('！', '');
    const word = t.data.words.find((w) => w.hanzi === greeting);
    t.assert(word, `greeting ${greeting} is not in the dictionary`);
    const p = await charCentre('.page h1 .zh', 0);
    await main.mouse.move(p.x - 30, p.y);
    await main.mouse.move(p.x, p.y, { steps: 3 });
    await t.waitFor(main, '.tip .vi', word.vi);
    const py = (await t.text(main, '.tip .py'))?.replace(/\s/g, '');
    t.assert(py === word.pinyin.replace(/\s/g, ''), `tooltip pinyin "${py}", expected "${word.pinyin}"`);
  });

  await t.step('tooltip hides over Vietnamese text', async () => {
    const box = await (await main.$('.page .lead')).boundingBox();
    await main.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 3 });
    await main.waitForFunction(() => !document.querySelector('.tip'), { timeout: 3000 });
  });
}
