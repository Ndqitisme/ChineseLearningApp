// With only HSK 1–3 open (no pack loaded), hovering 签 (an HSK 5 word) in a core example sentence
// still gives its pinyin from the fallback reader, without leaking the locked word's meaning. The assistant window has
// no fallback reader: there a locked dictionary word (设计, HSK 5 in the 2025 edition) gives its pinyin only.
export const seed = { 'settings.json': { settings: { hskOpen: 3, hsk: [1], showExample: true, guessFirst: false, settingsVersion: 3, onboarded: true } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const host = t.data.words.find((w) => w.id === '合同');
  const at = host.ex.zh.indexOf('签');
  const main = await t.open('main', '#/word/合同');

  await t.step('hover 签 while HSK 5 is locked', async () => {
    await t.waitFor(main, '.ex-zh', host.ex.zh);
    const p = await main.$eval('.ex-zh', (el, n) => {
      const node = [...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
      const r = document.createRange();
      r.setStart(node, n);
      r.setEnd(node, n + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, at);
    // The fallback reader loads on the first unknown character, so hover twice.
    for (let i = 0; i < 2; i++) {
      await main.mouse.move(p.x - 40, p.y);
      await main.mouse.move(p.x, p.y, { steps: 4 });
      await new Promise((r) => setTimeout(r, 800));
    }
    await t.waitFor(main, '.tip .py');
    const py = (await t.text(main, '.tip .py'))?.trim();
    t.assert(py === 'qiān', `fallback pinyin "${py}"`);
    t.assert(!(await main.$('.tip .vi')), 'tooltip shows a meaning for a locked word');
  });

  await t.step('assistant: hover 设 of a locked word in the example', async () => {
    const pet = await t.open('pet');
    // HoverPinyin samples the pointer in requestAnimationFrame, which only the front tab runs.
    await pet.bringToFront();
    await pet.waitForSelector('.bubble .ex .han', { timeout: 20_000 });
    // Past the bubble's pop-in scale, which moves every character while it runs.
    await new Promise((r) => setTimeout(r, 600));
    // Any shown word will do: its example line is replaced by one that holds the locked word.
    const p = await pet.$eval('.bubble .ex .han', (el) => {
      el.firstChild.data = '我是做设计的。';
      const r = document.createRange();
      r.setStart(el.firstChild, 3);
      r.setEnd(el.firstChild, 4);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await pet.mouse.move(p.x - 30, p.y - 30);
    await pet.mouse.move(p.x, p.y, { steps: 4 });
    await t.waitFor(pet, '.tip .py');
    const py = (await t.text(pet, '.tip .py'))?.trim();
    t.assert(py === 'shèjì', `assistant pinyin "${py}"`);
    t.assert(!(await pet.$('.tip .vi')), 'assistant tooltip shows a meaning for a locked word');
  });
}
