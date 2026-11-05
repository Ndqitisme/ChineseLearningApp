// With only HSK 1–3 open (no pack loaded), hovering 签 (an HSK 5 word) in a core example sentence
// still gives its pinyin from the fallback reader, without leaking the locked word's meaning.
export const seed = { 'settings.json': { settings: { hskOpen: 3, hsk: [1], settingsVersion: 3, onboarded: true } } };

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
}
