// Hover pinyin over an HSK 5 word (签, only in the HSK 5 pack) inside a core example sentence,
// on the word page and in the assistant's bubble, with HSK 1–5 open. The tooltip shows its pinyin and
// meaning and stays inside the window. Words change every 60 s so 合同, once shown, stays up: its
// one-minute gap would keep the tray "next" from bringing it back.
const HOST = '合同'; // business topic word; example "我们明天签合同。"
const TARGET = '签';

/** @param {{ data: any }} t */
function others(data) {
  const topic = data.topics.find((x) => x.id === 'business');
  return Object.fromEntries(topic.words.filter((id) => id !== HOST).map((id) => [id, { n: 6, t: 1, k: true }]));
}
import { readFileSync } from 'node:fs';
const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
export const seed = {
  'settings.json': { settings: { hskOpen: 5, hsk: [], topics: ['business'], showExample: true, guessFirst: false, wordSec: 60, settingsVersion: 3, onboarded: true } },
  'progress.json': { exposure: others(core) },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const host = t.data.words.find((w) => w.id === HOST);
  const target = t.packs[5].words.find((w) => w.hanzi === TARGET);
  t.assert(host.ex?.zh.includes(TARGET) && target, 'test data moved: pick another host sentence');
  const at = host.ex.zh.indexOf(TARGET);

  async function hoverChar(page, selector, i) {
    const p = await page.$eval(selector, (el, n) => {
      const node = [...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
      const r = document.createRange();
      const off = node.textContent.indexOf(node.textContent.trim());
      r.setStart(node, off + n);
      r.setEnd(node, off + n + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, i);
    await page.mouse.move(p.x - 40, p.y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  async function checkTip(page) {
    await t.waitFor(page, '.tip .vi', target.vi);
    const py = (await t.text(page, '.tip .py'))?.replace(/\s/g, '');
    t.assert(py === target.pinyin, `tooltip pinyin "${py}", expected ${target.pinyin}`);
    const { box, vw, vh } = await page.$eval('.tip', (el) => ({ box: el.getBoundingClientRect().toJSON(), vw: innerWidth, vh: innerHeight }));
    t.assert(box.left >= 0 && box.top >= 0 && box.right <= vw && box.bottom <= vh, `tooltip ${JSON.stringify(box)} outside ${vw}x${vh}`);
  }

  const pet = await t.open('pet');
  const main = await t.open('main', `#/word/${encodeURIComponent(HOST)}`);

  await t.step('word page: hover 签 in the example sentence', async () => {
    await t.waitFor(main, '.ex-zh', host.ex.zh);
    await hoverChar(main, '.ex-zh', at);
    await checkTip(main);
  });

  await t.step('bubble shows the host word with its example', async () => {
    // Puppeteer's waits poll on requestAnimationFrame, which only the front tab runs reliably.
    await pet.bringToFront();
    await t.waitFor(pet, '.bubble .hanzi', undefined, 10_000);
    for (let i = 0; i < 6 && (await t.text(pet, '.bubble .hanzi')) !== HOST; i++) {
      await t.emitTo(main, 'pet', 'tray:command', 'next');
      await new Promise((r) => setTimeout(r, 900));
    }
    t.assert((await t.text(pet, '.bubble .hanzi')) === HOST, `bubble shows ${await t.text(pet, '.bubble .hanzi')}`);
    await t.waitFor(pet, '.bubble .ex .han', host.ex.zh);
  });

  await t.step('bubble: hover 签 in the example sentence', async () => {
    // HoverPinyin samples the pointer in requestAnimationFrame, which only the front tab runs.
    await pet.bringToFront();
    await hoverChar(pet, '.bubble .ex .han', at);
    await checkTip(pet);
  });

  /** Glyph box of character `i` in `selector`'s first text node, and the line-height around it (viewport px). */
  const glyph = (page, selector, i) => page.$eval(selector, (el, n) => {
    const node = [...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
    const r = document.createRange();
    r.setStart(node, n);
    r.setEnd(node, n + 1);
    return { ...r.getBoundingClientRect().toJSON(), lineHeight: parseFloat(getComputedStyle(el).lineHeight) };
  }, i);
  /** Pointer moves dispatched in one task, so they land in the same animation frame. */
  const movesInOneFrame = (page, points) => page.evaluate((ps) => {
    for (const p of ps) document.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true }));
  }, points);
  const clearTip = async (page, b) => {
    await movesInOneFrame(page, [{ x: b.x + b.width / 2, y: b.y + b.height + 30 }]);
    await page.waitForFunction(() => !document.querySelector('.tip'), { timeout: 3000 });
  };

  await t.step('bubble: two moves in one frame, the second on 签, show 签', async () => {
    await pet.bringToFront();
    const bubble = await (await pet.$('.bubble')).boundingBox();
    await clearTip(pet, bubble);
    const before = await glyph(pet, '.bubble .ex .han', at - 1);
    const target = await glyph(pet, '.bubble .ex .han', at);
    const mid = (g) => ({ x: g.left + g.width / 2, y: g.top + g.height / 2 });
    await movesInOneFrame(pet, [mid(before), mid(target)]);
    await checkTip(pet);
  });

  await t.step('bubble: pointer in the line box below the glyph still shows 签', async () => {
    const bubble = await (await pet.$('.bubble')).boundingBox();
    await clearTip(pet, bubble);
    const g = await glyph(pet, '.bubble .ex .han', at);
    const lineBottom = (g.top + g.bottom) / 2 + g.lineHeight / 2;
    console.log(`      glyph ${g.top.toFixed(1)}–${g.bottom.toFixed(1)}, line box to ${lineBottom.toFixed(1)}`);
    t.assert(lineBottom - 1 > g.bottom, 'the line box is no taller than the glyph here: nothing to test');
    await movesInOneFrame(pet, [{ x: g.left + g.width / 2, y: lineBottom - 1 }]);
    await checkTip(pet);
  });
}
