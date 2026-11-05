// Hover pinyin over an HSK 5 word (签, only in the HSK 5 pack) inside a core example sentence,
// on the word page and in the assistant's bubble, with HSK 1–5 open. The tooltip shows its pinyin and
// meaning and stays inside the window.
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
  'settings.json': { settings: { hskOpen: 5, hsk: [], topics: ['business'], showExample: true, guessFirst: false, settingsVersion: 3, onboarded: true } },
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
}
