// Edge cases: the pet hint with nothing on, out-of-range lesson routes, locked words after the packs load, and the narrow layout.
import { readFileSync } from 'node:fs';

const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const p6 = JSON.parse(readFileSync('src/generated/hsk6.json', 'utf8'));
const coreHanzi = new Set(core.words.map((w) => w.hanzi));
const w6 = p6.words.find((w) => !core.words.some((c) => c.hanzi.includes(w.hanzi)));
const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

export const seed = { 'settings.json': { settings: { hskEdition: 2021, settingsVersion: 3, hskOpen: 3, hsk: [], topics: [], onboarded: true } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/');
  const check = (cond, msg) => { if (!cond) t.problems.push(`assertion: ${msg}`); };

  await t.step('R1 pet with nothing on shows the hint', async () => {
    await t.emitTo(main, 'pet', 'tray:command', 'next');
    await wait(pet, 1800);
    const nap = await t.text(pet, '.nap');
    console.log(`      pet: bubble ${await t.text(pet, '.bubble .hanzi')} nap "${nap}"`);
    check(nap?.includes('Chưa bật'), `no hint, nap "${nap}"`);
  });

  await t.step('R2 turning a topic on brings a word back', async () => {
    await go(main, '#/topics');
    await t.waitFor(main, '.bell');
    await main.$eval('.bell', (b) => b.click());
    await main.waitForFunction(() => (JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.topics ?? []).length === 1);
    await t.emitTo(main, 'pet', 'tray:command', 'next');
    await wait(pet, 2000);
    const h = await t.text(pet, '.bubble .hanzi');
    const nap = await t.text(pet, '.nap');
    console.log(`      pet after a topic is on: bubble ${h} nap "${nap}"`);
    check(h && !nap, `pet still shows hint "${nap}" / bubble ${h}`);
  });

  await t.step('R3 out-of-range and odd lessons', async () => {
    for (const h of ['#/quiz/meaning/hsk/3/0', '#/quiz/meaning/hsk/3/abc', '#/quiz/meaning/hsk/3/1.5', '#/quiz/meaning/hsk/3/-1',
      '#/write/hsk/3/99', '#/tones/hsk/3/99', '#/build/order/hsk/3/99', '#/quiz/hanzi/hsk/5/1', '#/write/hsk/4', '#/tones/hsk/6/1']) {
      await go(main, '#/');
      await go(main, h);
      await t.waitFor(main, '.lead');
      await wait(main, 150);
      const empty = await t.text(main, '.empty');
      const link = await main.$eval('.empty a', (a) => a.getAttribute('href')).catch(() => null);
      console.log(`      ${h}: "${empty}" → ${link}`);
      check(empty && /không có Bài|đang khoá/.test(empty) && link?.startsWith('#/hsk/'), `${h}: "${empty}"`);
    }
  });

  await t.step('R4 lesson 1 of HSK 3 is playable, listen quiz hints the voice', async () => {
    await go(main, '#/quiz/meaning/hsk/3/1');
    await t.waitFor(main, '.option');
    await go(main, '#/');
    await go(main, '#/quiz/listen/hsk/3/1');
    await t.waitFor(main, '.listen');
    const hint = await t.text(main, '.card .muted.small');
    console.log(`      listen hint: "${hint}"`);
    check(hint?.includes('Giọng đọc'), `listen hint "${hint}"`);
  });

  await t.step('R5 locked word page on a fresh install, then not-found', async () => {
    await go(main, `#/word/${encodeURIComponent(w6.id)}`);
    await t.waitFor(main, '.empty', 'đang khoá', 15000);
    console.log(`      ${await t.text(main, '.empty')}`);
    await go(main, '#/word/khongco');
    await t.waitFor(main, '.empty', 'Không tìm thấy');
  });

  await t.step('R6 after the word page loaded every pack, HSK 4–6 stays hidden elsewhere', async () => {
    await go(main, '#/about');
    await t.waitFor(main, '.card b');
    const line = (await t.text(main, '.counts'))?.split('\n').map((x) => x.trim()).join(' · ');
    console.log(`      about: ${line}`);
    // The core also holds 2025 HSK 1–3 words; with the 2021 lists (seeded) only topic words and 2021 HSK 1–3 count.
    const open13 = core.words.filter((w) => w.topics.length || (w.hsk && w.hsk <= 3)).length;
    check(line?.startsWith(`${open13} từ`) && line.includes('cấp 1–3'), `about "${line}"`);
    await go(main, `#/search/${w6.hanzi}`);
    await wait(main, 400);
    const rows = await t.texts(main, '.word-row .hanzi, a.row .hz, .result .hanzi');
    console.log(`      search ${w6.hanzi}: ${JSON.stringify(rows)} empty "${await t.text(main, '.empty')}"`);
    check(!(await t.text(main, '.page'))?.includes(w6.vi), `search shows locked ${w6.hanzi} "${w6.vi}"`);
    await go(main, '#/topics');
    await t.waitFor(main, '.topic.locked');
    check((await main.$$('.topic.locked')).length === 3, 'HSK 4–6 cards not locked');
  });

  await t.step('R7 hover a locked HSK 5 word after the packs were loaded', async () => {
    const host = core.words.find((w) => w.id === '合同');
    await go(main, '#/word/合同');
    await t.waitFor(main, '.ex-zh', host.ex.zh);
    const at = host.ex.zh.indexOf('签');
    const p = await main.$eval('.ex-zh', (el, n) => {
      const node = [...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
      const r = document.createRange();
      r.setStart(node, n);
      r.setEnd(node, n + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, at);
    for (let i = 0; i < 2; i++) {
      await main.mouse.move(p.x - 40, p.y);
      await main.mouse.move(p.x, p.y, { steps: 4 });
      await wait(main, 800);
    }
    const vi = await t.text(main, '.tip .vi');
    console.log(`      tooltip: ${await t.text(main, '.tip')}`);
    check(!vi, `tooltip shows the meaning "${vi}" of a word of locked HSK 5`);
  });

  await t.step('R8 860x600: Settings › HSK still scrolls to its section; course card from the bottom opens at top', async () => {
    await main.setViewport({ width: 860, height: 600 });
    await go(main, '#/');
    await go(main, '#/settings/hsk');
    await wait(main, 600);
    const top = await main.$eval('#hsk', (el) => Math.round(el.getBoundingClientRect().top)).catch(() => null);
    console.log(`      #hsk top ${top}`);
    check(top !== null && top >= 0 && top < 600, `#hsk at ${top}`);
    await go(main, '#/topics');
    await t.waitFor(main, 'a[href="#/hsk/3"]');
    await main.$eval('a[href="#/hsk/3"]', (a) => a.scrollIntoView());
    await main.click('a[href="#/hsk/3"]');
    await t.waitFor(main, '.lesson');
    await wait(main, 300);
    const h1 = await main.$eval('h1', (el) => Math.round(el.getBoundingClientRect().top));
    console.log(`      course h1 top ${h1}`);
    check(h1 >= 0, `course h1 at ${h1}`);
    await main.evaluate(() => history.back());
    await wait(main, 400);
    console.log(`      back to topics: scrollTop ${await main.$eval('main.content', (m) => m.scrollTop)}`);
  });

  await t.step('R9 bubble never shows a pack word that is not core while 1–3 are open', async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await t.emitTo(main, 'pet', 'tray:command', 'next');
      await wait(pet, 1800);
      seen.push(await t.text(pet, '.bubble .hanzi'));
    }
    console.log(`      bubble: ${seen.join(' ')}`);
    check(seen.every((h) => h && coreHanzi.has(h)), `bubble ${seen}`);
  });
}
