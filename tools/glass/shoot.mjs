// Regenerates the glass screenshot set: node shoot.mjs [out-dir] [filter]
// Every main-window page in Biển light/dark (860×600), Hoa anh đào light and Đêm sao dark (1400×900),
// theme-specific extras, key states, the forced WebKit fallback, prefers-reduced-transparency, and the
// assistant bubble. Writes manifest.json (file → page, focus, theme, mode, size, state) and errors.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORK, data, seedFor, sleep, start } from './harness.mjs';

const OUT = process.argv[2] ?? `${WORK}/final`;
const FILTER = process.argv[3] ?? '';
mkdirSync(OUT, { recursive: true });

const SMALL = { width: 860, height: 600 }, LARGE = { width: 1400, height: 900 };
const THEME_NAME = { ocean: 'Biển xanh', sakura: 'Hoa anh đào', night: 'Đêm sao', matcha: 'Matcha', boba: 'Trà sữa' };
const greetings = data.topics.find((t) => t.id === 'greetings').words;
const longest = data.words.filter((w) => w.ex && w.topics.length).sort((a, b) => b.vi.length - a.vi.length)[0];
const wordId = longest.id;
const PAGES = [
  ['home', '#/', 'stat cards, quick-start cards, recent words'],
  ['topics', '#/topics', 'topic grid (22 cards), bells, HSK cards, edition chips'],
  ['topic', '#/topic/greetings', 'action pills, search field, word list card'],
  ['hsk', '#/hsk/1', 'lesson cards with summaries'],
  ['word', `#/word/${wordId}`, 'hero card, stroke boxes, chips, pills, example card'],
  ['practice', '#/practice', 'mode cards (one off)'],
  ['quiz', '#/quiz/meaning', 'progress bar, question card, option cards'],
  ['review', '#/review', 'flash card (refraction)'],
  ['write', '#/write', 'target card, switches, board, tool pills'],
  ['build', '#/build/order', 'tabs, dashed answer box, tiles, disabled pill'],
  ['tones', '#/tones', 'drill card, tone buttons, disabled pill, plot'],
  ['search', '#/search/ni', 'search field (refraction), results card'],
  ['notebook', '#/notebook', 'pills, list card'],
  ['settings', '#/settings', 'theme swatches, chips, switches, sliders, select, inputs, textarea'],
  ['about', '#/about', 'cards, table, chips'],
  ['support', '#/support', 'QR card, copy pill'],
];

const manifest = [];
const errorsOut = {};
const h = await start();
let n = 0;
const file = (name) => `${String(++n).padStart(3, '0')}-${name}.png`;

async function shot(page, name, meta) {
    const f = file(name);
  await page.screenshot({ path: join(OUT, f), omitBackground: meta.window === 'pet' && meta.state !== 'on busy desktop' });
  manifest.push({ file: f, ...meta });
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('  ', f);
}
/** The window over a busy desktop: its transparent capture drawn over a capture of the wallpaper alone. */
async function busyShot(page, name, meta, bg) {
  const top = await page.screenshot({ encoding: 'base64', omitBackground: true });
  await page.evaluate((bg) => { document.body.style.setProperty('background', bg, 'important'); const s = document.createElement('style'); s.id = 'wall-only'; s.textContent = 'body > * { visibility: hidden !important; }'; document.head.append(s); }, bg);
  await sleep(150);
  const wall = await page.screenshot({ encoding: 'base64' });
  await page.evaluate(() => { document.getElementById('wall-only').remove(); document.body.style.removeProperty('background'); });
  const png = await page.evaluate(async (wall, top) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [a, b] = await Promise.all([load(wall), load(top)]);
    const c = document.createElement('canvas'); c.width = a.width; c.height = a.height; const g = c.getContext('2d'); g.drawImage(a, 0, 0); g.drawImage(b, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, wall, top);
  const f = file(name);
  writeFileSync(join(OUT, f), Buffer.from(png, 'base64'));
  manifest.push({ file: f, ...meta });
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('  ', f);
}
async function goto(page, hash) {
  await page.evaluate((x) => { location.hash = x; }, hash);
  await page.waitForFunction((x) => decodeURIComponent(location.hash) === x && document.querySelector('.page'), { timeout: 15_000 }, hash);
  await h.settle(page, 450);
}
const scrollTo = (page, y) => page.evaluate((v) => { const c = document.querySelector('main.content'); c.scrollTop = v < 0 ? c.scrollHeight : v; }, y);

async function set(spec) {
  const { theme, mode, size, query = '', media = [], settings = {}, progress, pages = PAGES, tag = '' } = spec;
  const w = await h.open({ hash: pages[0][1], query, size, media, seed: seedFor({ theme, mode, settings, progress }) });
  const meta = (page, focus, state) => ({ window: 'main', page, focus, theme: THEME_NAME[theme], mode, size: `${size.width}x${size.height}`, state });
  const label = `${theme}-${mode}-${size.width}${tag}`;
  console.log(label);
  try {
    for (const [name, hash, focus] of pages) {
      await goto(w.page, hash);
      // The default state is the resting one: no autofocused field (the search page focuses its input on open).
      await w.page.evaluate(() => document.activeElement?.blur()); await w.page.mouse.move(2, 2);
      if (tag === '-empty' && name === 'home') { await w.page.evaluate(() => document.querySelector('.page .empty')?.scrollIntoView({ block: 'center' })); await h.settle(w.page, 150); }
      await shot(w.page, `${label}-${name}`, meta(name, focus, 'default'));
      if (name.startsWith('word-')) {
        await scrollTo(w.page, -1); await h.settle(w.page, 150);
        await shot(w.page, `${label}-${name}-bottom`, meta(name, 'full CVDICT meaning: Han characters inside Vietnamese UI text fall through Nunito to Kai', 'scrolled to bottom'));
      }
      if (name === 'settings' || name === 'topics') {
        await scrollTo(w.page, name === 'settings' ? 700 : 900); await h.settle(w.page, 150);
        await shot(w.page, `${label}-${name}-scrolled`, meta(name, focus, 'scrolled'));
        await scrollTo(w.page, -1); await h.settle(w.page, 150);
        await shot(w.page, `${label}-${name}-bottom`, meta(name, focus, 'scrolled to bottom'));
      }
      if (name === 'settings') {
        // The "CSS riêng" panel open: at rest, then with keyboard focus in the textarea.
        await w.page.evaluate(() => { const d = [...document.querySelectorAll('.page details')].find((x) => x.querySelector('textarea')); d.open = true; d.scrollIntoView({ block: 'center' }); });
        await h.settle(w.page, 200);
        await shot(w.page, `${label}-${name}-css-open`, meta(name, 'CSS riêng panel open', 'open'));
        await w.page.keyboard.press('Shift'); await w.page.focus('.page details textarea'); await sleep(200);
        await shot(w.page, `${label}-${name}-css-focus`, meta(name, 'CSS riêng textarea with keyboard focus', 'focus'));
        await w.page.evaluate(() => { document.activeElement?.blur(); for (const d of document.querySelectorAll('.page details')) d.open = false; });
      }
    }
    if (spec.states) await spec.states(w.page, (name, page, focus, state) => shot(w.page, `${label}-${name}`, meta(page, focus, state)));
  } finally {
    if (w.errors.length) errorsOut[label] = w.errors;
    await w.close();
  }
}

/** Keyboard focus on a control: script focus, Tab away, Shift+Tab back. Script focus alone can land on a control that
 *  already holds pointer focus, which never shows a ring. */
async function tabFocus(page, sel) {
  await page.evaluate((sel) => document.querySelector(sel).focus({ preventScroll: true }), sel);
  const back = () => page.evaluate((sel) => document.activeElement === document.querySelector(sel), sel);
  await page.keyboard.press('Tab'); await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  if (await back()) return;
  // The last control on a page: Tab leaves the document, so come back the other way.
  await page.evaluate((sel) => document.querySelector(sel).focus({ preventScroll: true }), sel);
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await page.keyboard.press('Tab');
  if (!(await back())) throw new Error(`Tab and Shift+Tab do not return to ${sel}`);
}

/** Pressed (pointer down, released outside so nothing toggles), hovered and keyboard-focused shots of one control. */
async function controlStates(page, shot, sel, name, pageName) {
  const el = await page.$(sel); await el.evaluate((n) => n.scrollIntoView({ block: 'center' })); await sleep(150);
  const b = await el.boundingBox();
  // Hover is shot unfocused (the search page focuses its field on open), so it can be told apart from focus.
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await sleep(250);
  await shot(`${name}-hover`, pageName, `${name} hovered`, 'hover');
  await page.mouse.down(); await sleep(200);
  await shot(`${name}-press`, pageName, `${name} pressed`, 'pressed');
  await page.mouse.move(2, 2); await page.mouse.up(); await sleep(150);
  // Moving the pointer away with the button down drags a text selection across the window: clear it before the focus shot.
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await tabFocus(page, sel.endsWith('.switch') ? `${sel} input` : sel); await sleep(200);
  await shot(`${name}-focus`, pageName, `${name} keyboard focus`, 'focus');
  await page.evaluate(() => document.activeElement?.blur());
}

/** App chrome and list pages: sidebar, home stat card, search rows, HSK rows and pills, filter and back pill, notebook
 *  pills, the copy pill and its copied state. */
async function chromeStates(page, shot) {
  await goto(page, '#/');
  await controlStates(page, shot, '.side a:not(.on)', 'nav-item', 'home');
  await controlStates(page, shot, '.stat.link', 'home-stat', 'home');
  await goto(page, '#/search/ni');
  await controlStates(page, shot, '.search', 'search-field', 'search');
  await controlStates(page, shot, 'a.row', 'search-row', 'search');
  await goto(page, '#/hsk/1');
  await controlStates(page, shot, 'details summary', 'hsk-lesson-row', 'hsk');
  await controlStates(page, shot, '.page > .row .btn, .actions .btn', 'hsk-mode-pill', 'hsk');
  await goto(page, '#/topic/greetings');
  await controlStates(page, shot, '.actions input', 'filter-field', 'topic');
  await controlStates(page, shot, '.back-btn', 'back-pill', 'topic');
  await goto(page, '#/notebook');
  if (await page.$('.page .btn')) await controlStates(page, shot, '.page .btn', 'notebook-pill', 'notebook');
  await goto(page, '#/support');
  await controlStates(page, shot, '.copy', 'copy-pill', 'support');
  await page.click('.copy'); await page.mouse.move(2, 2); await sleep(300);
  await shot('support-copied', 'support', 'copy pill after a click (copied state)', 'copied');
}

/** Practice hub, review, write, build and tones controls not covered elsewhere: hover, press, focus. */
async function moreStates(page, shot) {
  await goto(page, '#/practice');
  await controlStates(page, shot, '.mode:not(.off)', 'practice-mode', 'practice');
  if (await page.$('.mode.off')) { await page.hover('.mode.off'); await sleep(250); await shot('practice-hover-off', 'practice', 'mode card turned off (no voice), hovered', 'hover'); await page.mouse.move(2, 2); }
  await goto(page, '#/review');
  await controlStates(page, shot, '.flash', 'review-flash', 'review');
  await goto(page, '#/review');
  await page.click('.flash'); await sleep(400);
  await controlStates(page, shot, '.grades .good', 'review-grade', 'review');
  await goto(page, '#/quiz/meaning');
  await page.click('.option'); await sleep(400);
  await controlStates(page, shot, '.next .btn', 'quiz-next', 'quiz');
  await goto(page, '#/write');
  await controlStates(page, shot, '.tools .btn', 'write-tool', 'write');
  await controlStates(page, shot, '.target .switch', 'write-switch', 'write');
  await goto(page, '#/build/order');
  await controlStates(page, shot, '.tabs .chip:not(.on)', 'build-tab', 'build');
  await goto(page, '#/tones');
  await controlStates(page, shot, '.speak .btn.primary', 'tones-record', 'tones');
  await goto(page, '#/tones');
  for (const s of await page.$$('.syl')) await (await s.$('.tone')).click();
  await page.click('.drill .btn.primary'); await sleep(500);
  await shot('tones-checked-next', 'tones', 'checked, scrolled to the next pill under the drill card', 'checked');
}

/** Practice pages: keyboard focus and pressed shots, then the answered, flipped, result and checked states. */
async function practiceStates(page, shot, withResults = true) {
  const result = (name, pageName, focus, state) => withResults ? shot(name, pageName, focus, state) : null;
  const focusShot = async (sel, name, pageName, focus) => {
    await tabFocus(page, sel); await sleep(200);
    await shot(name, pageName, focus, 'focus');
    await page.evaluate(() => document.activeElement?.blur());
  };
  const pressShot = async (sel, name, pageName, focus) => {
    const el = await page.$(sel); await el.evaluate((n) => n.scrollIntoView({ block: 'nearest' })); await sleep(150);
    const b = await el.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await sleep(200);
    await shot(name, pageName, focus, 'pressed');
    await page.mouse.move(2, 2); await page.mouse.up(); await sleep(150);
  };
  await goto(page, '#/quiz/meaning');
  await focusShot('.option:nth-of-type(2)', 'quiz-focus-option', 'quiz', 'option card, keyboard focus');
  await pressShot('.option:nth-of-type(2)', 'quiz-press-option', 'quiz', 'option card pressed');
  await page.click('.option'); await sleep(400);
  await result('quiz-answered', 'quiz', 'right/wrong option tints, disabled options, next pill', 'answered');
  await goto(page, '#/review');
  await tabFocus(page, '.flash'); await sleep(200);
  await shot('review-focus-flash', 'review', 'flash card, keyboard focus', 'focus');
  await page.evaluate(() => document.activeElement?.blur());
  await page.click('.flash'); await sleep(400);
  await result('review-flipped', 'review', 'flipped card, grade pills in four tints', 'flipped');
  await focusShot('.grades .good', 'review-focus-grade', 'review', 'grade pill, keyboard focus');
  await goto(page, '#/build/order');
  await focusShot('.pool .tile', 'build-focus-tile', 'build', 'tile, keyboard focus');
  for (const t of (await page.$$('.pool .tile:not(.used)'))) await t.click();
  await sleep(200);
  await page.click('.actions .btn.primary'); await sleep(400);
  await result('build-result', 'build', 'scored answer: ok/off tiles, reference, next pill', 'result');
  await goto(page, '#/tones');
  await focusShot('.syl .tone', 'tones-focus-tone', 'tones', 'tone button, keyboard focus');
  await pressShot('.syl .tone:nth-of-type(2)', 'tones-press-tone', 'tones', 'tone button pressed');
  for (const s of await page.$$('.syl')) await (await s.$('.tone')).click();
  await sleep(200);
  await page.click('.drill .btn.primary'); await sleep(400);
  await result('tones-checked', 'tones', 'right/wrong tone buttons, disabled', 'checked');
}

/** Key states, run in one context. */
async function states(page, shot) {
  await goto(page, '#/');
  await page.hover('.action'); await sleep(250);
  await shot('home-hover-action', 'home', 'quick-start card hovered (refraction on hover)', 'hover');
  await topicStates(page, shot);
  await page.hover('.side a:nth-of-type(3)'); await sleep(250);
  await shot('topics-hover-nav', 'topics', 'sidebar item hovered', 'hover');
  // Edition chips and the unlock pill, at 860.
  await controlStates(page, shot, '.content .chip:not(.on)', 'topics-edition-chip', 'topics');
  await controlStates(page, shot, '.content .btn:not(.primary):not(:disabled)', 'topics-unlock', 'topics');
  await lightStates(page, shot);
}

/** Topic card and bell: hover, press, toggled, keyboard focus. */
async function topicStates(page, shot) {
  await goto(page, '#/topics');
  await page.hover('.topic:nth-of-type(2)'); await sleep(250);
  await shot('topics-hover-card', 'topics', 'topic card hovered', 'hover');
  await page.hover('.topic:nth-of-type(2) .bell'); await sleep(250);
  await shot('topics-hover-bell', 'topics', 'bell hovered', 'hover');
  const bell = await page.$('.topic:nth-of-type(2) .bell');
  const bb = await bell.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await sleep(200);
  await shot('topics-press-bell', 'topics', 'bell pressed', 'pressed');
  await page.mouse.up(); await sleep(200);
  await shot('topics-bell-on', 'topics', 'bell on (filled hue) after click', 'toggled on');
  await page.mouse.move(2, 2); await page.keyboard.press('Shift');
  await page.focus('.topic:nth-of-type(2) .body'); await sleep(200);
  await shot('topics-focus-card', 'topics', 'keyboard focus on a topic card', 'focus');
  await page.focus('.topic:nth-of-type(2) .bell'); await sleep(200);
  await shot('topics-focus-bell', 'topics', 'keyboard focus on a bell', 'focus');
  await page.evaluate(() => document.activeElement?.blur());
  // Leave the bell as it was.
  await page.click('.topic:nth-of-type(2) .bell'); await page.mouse.move(2, 2); await sleep(200);
}

async function lightStates(page, shot) {
  await goto(page, '#/topic/greetings');
  await page.click('.actions input'); await page.mouse.move(5, 5); await sleep(150);
  await shot('topic-focus-search', 'topic', 'search field focused (ring outside the glass pill)', 'focus');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  await sleep(150);
  await shot('topic-focus-row', 'topic', 'keyboard focus ring on a list row', 'focus');
  await page.type('.actions input', 'xin'); await sleep(300);
  await shot('topic-filtered', 'topic', 'search field with text', 'typed');
  const btn = await page.$('.actions .btn');
  const b1 = await btn.boundingBox();
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2); await sleep(150);
  await shot('topic-hover-pill', 'topic', 'primary pill hovered', 'hover');
  await page.mouse.down(); await sleep(200);
  await shot('topic-press-pill', 'topic', 'primary pill pressed (glass sinks, bend shrinks)', 'pressed');
  await page.mouse.move(5, 5); await page.mouse.up();
  const btn2 = (await page.$$('.actions .btn'))[1];
  const b2 = await btn2.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down(); await sleep(200);
  await shot('topic-press-pill-plain', 'topic', 'plain pill pressed', 'pressed');
  await page.mouse.move(5, 5); await page.mouse.up();
  await goto(page, `#/word/${wordId}`);
  const back = await page.$('.back-btn');
  const b3 = await back.boundingBox();
  await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2); await page.mouse.down(); await sleep(200);
  await shot('word-press-back', 'word', 'back pill pressed', 'pressed');
  await page.mouse.move(5, 5); await page.mouse.up();
  const ex = await page.$('.ex-zh');
  await ex.evaluate((el) => el.scrollIntoView({ block: 'center' })); await sleep(250);
  // Aim at a Han character's own box (the 4th), as a reader would; the box edge is not a character.
  const c4 = await ex.evaluate((el) => { const t = el.firstChild; const i = [...t.data].findIndex((c, k) => k >= 6 && /\p{Script=Han}/u.test(c)); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(c4.x - 30, c4.y); await page.mouse.move(c4.x, c4.y, { steps: 3 });
  await page.waitForSelector('.tip', { timeout: 3000 }).catch(() => console.log('   no tooltip')); await sleep(300);
  await shot('word-tooltip', 'word', 'hover-pinyin tooltip (glass) over the example', 'tooltip');
  await page.mouse.move(5, 5);
  await goto(page, '#/quiz/meaning');
  await page.click('.option'); await sleep(400);
  await shot('quiz-answered', 'quiz', 'right/wrong option tints, disabled options, next pill', 'answered');
  await page.keyboard.press('Enter'); await sleep(300);
  await page.hover('.option:nth-of-type(2)'); await sleep(200);
  await shot('quiz-hover-option', 'quiz', 'option hovered', 'hover');
  await goto(page, '#/review');
  await page.click('.flash'); await sleep(400);
  await shot('review-flipped', 'review', 'flipped card, grade pills in four tints', 'flipped');
  await page.hover('.grades .good'); await sleep(200);
  await shot('review-hover-grade', 'review', 'grade pill hovered', 'hover');
  await goto(page, '#/build/order');
  await page.hover('.pool .tile'); await sleep(200);
  await shot('build-hover-tile', 'build', 'tile hovered', 'hover');
  const tiles = await page.$$('.pool .tile');
  const tb = await tiles[0].boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down(); await sleep(200);
  await shot('build-press-tile', 'build', 'tile pressed', 'pressed');
  await page.mouse.up(); await sleep(250);
  await shot('build-picked', 'build', 'one tile in the answer box, used tile faded', 'picked');
  for (const t of (await page.$$('.pool .tile:not(.used)'))) await t.click();
  await sleep(200);
  await page.click('.actions .btn.primary'); await sleep(400);
  await shot('build-result', 'build', 'scored answer: ok/off tiles, reference', 'result');
  await goto(page, '#/tones');
  for (const s of await page.$$('.syl')) await (await s.$('.tone')).click();
  await sleep(200);
  await shot('tones-picked', 'tones', 'tone buttons selected, Kiểm tra enabled', 'picked');
  await page.click('.drill .btn.primary'); await sleep(400);
  await shot('tones-checked', 'tones', 'right/wrong tone buttons, disabled', 'checked');
  await goto(page, '#/settings');
  await page.click('.themes .theme:nth-of-type(2)'); await sleep(400);
  await shot('settings-theme-switch', 'settings', 'another theme selected from the swatches', 'theme changed');
  await page.click('.themes .theme:nth-of-type(4)'); await sleep(400);
  await scrollTo(page, 420); await sleep(200);
  await page.click('.chip'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await sleep(200);
  await shot('settings-focus', 'settings', 'keyboard focus on a chip', 'focus');
  await page.keyboard.press('Shift'); await page.focus('.content .switch input'); await sleep(200);
  await shot('settings-focus-switch', 'settings', 'keyboard focus on a switch', 'focus');
  await page.evaluate(() => document.activeElement?.blur()); await page.hover('.content .switch'); await sleep(200);
  await shot('settings-hover-switch', 'settings', 'switch hovered', 'hover');
  await page.evaluate(() => document.querySelector('.content .switch').closest('.card').previousElementSibling.scrollIntoView({ block: 'start' })); await sleep(200);
  await page.click('.content .switch'); await sleep(300);
  await shot('settings-switch-toggled', 'settings', 'Bảng gợi ý turned off here: "Skin" and the skin list grey out and keep their values', 'toggled');
  await page.click('.content .switch'); await sleep(300);
  await page.click('.select-trigger'); await sleep(200);
  await page.keyboard.press('Escape');
  // A key press first: focus after mouse clicks is not :focus-visible, so the ring would not show.
  await page.keyboard.press('Shift'); await page.focus('.range input'); await sleep(200);
  await shot('settings-focus-slider', 'settings', 'slider focused', 'focus');
  await page.evaluate(() => document.activeElement?.blur());
  // Pressed states: pointer down on the control, shot, then release outside it so nothing toggles.
  const pressShot = async (sel, name, focus) => {
    const el = await page.$(sel); await el.evaluate((n) => n.scrollIntoView({ block: 'center' })); await sleep(150);
    const b = await el.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await sleep(200);
    await shot(name, 'settings', focus, 'pressed');
    await page.mouse.move(2, 2); await page.mouse.up(); await sleep(150);
  };
  await pressShot('.content .chip:not(.on)', 'settings-press-chip', 'chip pressed');
  await pressShot('.content .switch', 'settings-press-switch', 'switch pressed');
  await pressShot('.select-trigger', 'settings-press-select', 'listbox trigger pressed');
  await page.click('.select-trigger'); await sleep(300);
  await shot('settings-listbox-open', 'settings', 'listbox open (glass panel, chosen option in primary)', 'open');
  await page.keyboard.press('ArrowDown'); await sleep(150);
  await shot('settings-listbox-keyboard', 'settings', 'listbox, arrow key moved the active option', 'keyboard');
  await page.keyboard.press('Escape'); await sleep(150);
  await pressShot('.theme:not(.on)', 'settings-press-swatch', 'theme swatch pressed');
  await goto(page, '#/search/mifan');
  await page.click('.search'); await sleep(200);
  await shot('search-focus', 'search', 'search field focused with results', 'focus');
  // Sidebar switches: panel on with the character on, then off; panel off with the character switch disabled.
  await goto(page, '#/');
  await shot('sidebar-panel-on-character-on', 'home', 'sidebar: Bảng gợi ý on, Skin on', 'switches');
  await page.click('.pet-toggle:nth-of-type(2) .switch'); await sleep(350);
  await shot('sidebar-panel-on-character-off', 'home', 'sidebar: Bảng gợi ý on, Skin off', 'switches');
  await page.click('.pet-toggle:nth-of-type(1) .switch'); await sleep(350);
  await shot('sidebar-panel-off', 'home', 'sidebar: Bảng gợi ý off, Skin disabled (grey, keeps its value); home status lines', 'switches');
  await page.click('.pet-toggle:nth-of-type(1) .switch'); await sleep(350);
  await shot('sidebar-panel-on-again', 'home', 'sidebar: panel on again, Skin re-enabled with its kept value (off)', 'switches');
  await goto(page, '#/settings');
  await page.evaluate(() => document.querySelector('.content .switch').closest('.card').previousElementSibling.scrollIntoView({ block: 'start' })); await sleep(200);
  await shot('settings-pet-rows', 'settings', 'Bảng gợi ý rows (panel on, Skin off)', 'switches');
  await goto(page, '#/write');
  await page.hover('.tools .btn'); await sleep(200);
  await shot('write-hover-tool', 'write', 'tool pill hovered', 'hover');
  await practiceStates(page, shot, false);
  await moreStates(page, shot);
  await chromeStates(page, shot);
}


/** Edge zooms: element screenshots at 3x device pixels, for jagged or odd edges. */
async function zooms(theme, mode) {
  const w = await h.open({ hash: '#/topic/greetings', size: { ...SMALL, deviceScaleFactor: 3 }, seed: seedFor({ theme, mode }) });
  const meta = (page, focus, state = 'zoom 3x') => ({ window: 'main', page, focus, theme: THEME_NAME[theme], mode, size: '860x600 @3x', state });
  const grab = async (sel, name, page, focus, pad = 6) => {
    const el = await w.page.$(sel); if (!el) return console.log('   no', sel);
    const b = await el.boundingBox();
    const f = file(name);
    await w.page.screenshot({ path: join(OUT, f), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad } });
    manifest.push({ file: f, ...meta(page, focus) }); console.log('  ', f);
  };
  const z = (n) => `zoom-${theme}-${mode}-${n}`;
  try {
    await h.settle(w.page, 500);
    await grab('.actions .btn.primary', z('pill-primary'), 'topic', 'primary pill edge and bezel');
    await grab('.actions .btn:nth-of-type(2)', z('pill'), 'topic', 'plain pill edge and bezel');
    await grab('.actions input', z('search'), 'topic', 'search field edge');
    await grab('.back-btn', z('back'), 'topic', 'back pill');
    await grab('nav.side', z('sidebar'), 'topic', 'sidebar slab, rim and refraction at its edge', 10);
    await goto(w.page, '#/topics');
    await grab('.topic:nth-of-type(1)', z('card-on'), 'topics', 'selected topic card (refraction) corner, bell, bar');
    await grab('.topic:nth-of-type(2)', z('card'), 'topics', 'plain topic card corner and rim');
    await goto(w.page, '#/settings');
    await grab('.themes', z('themes'), 'settings', 'theme swatches');
    await grab('.row:has(.chip)', z('chips'), 'settings', 'chips on/off');
    await scrollTo(w.page, 400); await h.settle(w.page, 200);
    await grab('.content .switch', z('switch-on'), 'settings', 'switch on (lip profile)');
    await grab('.range', z('slider'), 'settings', 'slider track and knob');
    await grab('.select-trigger', z('select'), 'settings', 'select');
    await grab('.row.wrap:has(input[type=time])', z('switch-off'), 'settings', 'switch off, time inputs');
    await grab('.card.stack:nth-of-type(2)', z('settings-rows'), 'settings', 'control rows on the card (refract): switches, select, time inputs bend the card hatch', 4);
    await goto(w.page, '#/review');
    await grab('.flash', z('flash'), 'review', 'flash card corner (refraction)');
  } finally { if (w.errors.length) errorsOut['zoom-' + theme + mode] = w.errors; await w.close(); }
  // The same Settings rows with the fallback forced, for a side-by-side with the refract clip.
  const fb = await h.open({ hash: '#/settings', query: '?glass=fallback', size: { ...SMALL, deviceScaleFactor: 3 }, seed: seedFor({ theme, mode }) });
  try {
    await h.settle(fb.page, 500);
    await scrollTo(fb.page, 400); await h.settle(fb.page, 200);
    const el = await fb.page.$('.card.stack:nth-of-type(2)');
    const b = await el.boundingBox();
    const f = file(z('settings-rows-fallback'));
    await fb.page.screenshot({ path: join(OUT, f), clip: { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: b.width + 8, height: b.height + 8 } });
    manifest.push({ file: f, ...meta('settings', 'the same control rows with ?glass=fallback (blur only)') }); console.log('  ', f);
  } finally { await fb.close(); }
  const p = await h.open({ label: 'pet', seed: seedFor({ theme, mode, settings: { guessFirst: false } }) });
  try {
    await p.page.waitForSelector('.bubble .vi', { timeout: 20_000 });
    const size = await p.page.evaluate(() => window.__e2e.windowSize);
    await p.page.setViewport({ width: Math.round(size.width), height: Math.round(size.height), deviceScaleFactor: 3 });
    await h.settle(p.page, 400);
    await p.page.evaluate(() => document.body.style.setProperty('background', 'repeating-linear-gradient(45deg, #111 0 10px, #fafafa 10px 20px)', 'important'));
    const b = await (await p.page.$('.bubble')).boundingBox();
    const f = file(z('bubble'));
    await p.page.screenshot({ path: join(OUT, f), clip: { x: Math.max(0, b.x - 24), y: Math.max(0, b.y - 16), width: b.width + 40, height: b.height + 32 } });
    manifest.push({ file: f, window: 'pet', page: 'pet', focus: 'bubble tail, rim and shadow at 3x on stripes', theme: THEME_NAME[theme], mode, size: 'window @3x', state: 'zoom 3x' }); console.log('  ', f);
  } finally { await p.close(); }
}

const empty = { exposure: {}, srs: {}, seenDays: {}, reviewDays: {} };
const sets = [
  { theme: 'ocean', mode: 'light', size: SMALL, states },
  { theme: 'ocean', mode: 'dark', size: SMALL, settings: { petEnabled: false }, states: async (page, shot) => {
    await goto(page, '#/');
    await shot('sidebar-panel-off', 'home', 'sidebar: Bảng gợi ý off, Skin disabled (dark)', 'switches');
    await page.click('.pet-toggle:nth-of-type(1) .switch'); await sleep(350);
    await shot('sidebar-panel-on-character-on', 'home', 'sidebar: Bảng gợi ý on, Skin on (dark)', 'switches');
    await page.click('.pet-toggle:nth-of-type(2) .switch'); await sleep(350);
    await shot('sidebar-panel-on-character-off', 'home', 'sidebar: Bảng gợi ý on, Skin off (dark)', 'switches');
    await goto(page, '#/settings');
    await page.evaluate(() => document.querySelector('.content .switch').closest('.card').previousElementSibling.scrollIntoView({ block: 'start' })); await sleep(200);
    await shot('settings-pet-rows', 'settings', 'Bảng gợi ý rows (dark)', 'switches');
    await controlStates(page, shot, '.content .row:has(input[type=time]) .switch', 'settings-switch', 'settings');
    await controlStates(page, shot, '.content .row:has(.chip) .chip:not(.on)', 'settings-chip', 'settings');
    await controlStates(page, shot, '.select-trigger', 'settings-listbox', 'settings');
    await topicStates(page, shot);
    await practiceStates(page, shot);
    await moreStates(page, shot);
    await chromeStates(page, shot);
  } },
  { theme: 'sakura', mode: 'light', size: LARGE },
  { theme: 'night', mode: 'dark', size: LARGE, states: async (page, shot) => { await practiceStates(page, shot); await goto(page, '#/'); await controlStates(page, shot, '.side a:not(.on)', 'nav-item', 'home'); } },
  { theme: 'matcha', mode: 'light', size: SMALL, pages: PAGES.filter(([n]) => ['home', 'settings', 'topics', 'review'].includes(n)) },
  { theme: 'boba', mode: 'dark', size: SMALL, pages: PAGES.filter(([n]) => ['home', 'settings', 'topics', 'quiz'].includes(n)) },
  { theme: 'ocean', mode: 'light', size: SMALL, tag: '-empty', progress: empty, pages: [['notebook', '#/notebook', 'empty state'], ['review', '#/review', 'empty state card'], ['home', '#/', 'empty recent words']], states: async (page, shot) => {
    await goto(page, '#/review');
    await controlStates(page, shot, '.empty-card .btn', 'review-empty-pill', 'review');
  } },
  { theme: 'ocean', mode: 'light', size: SMALL, tag: '-fallback', query: '?glass=fallback', pages: PAGES.filter(([n]) => ['home', 'topics', 'settings', 'review', 'quiz', 'word', 'search'].includes(n)) },
  { theme: 'ocean', mode: 'dark', size: SMALL, tag: '-fallback', query: '?glass=fallback', pages: PAGES.filter(([n]) => ['home', 'topics', 'settings', 'review', 'quiz', 'word', 'search'].includes(n)) },
  { theme: 'ocean', mode: 'light', size: SMALL, tag: '-reduced-transparency', media: [{ name: 'prefers-reduced-transparency', value: 'reduce' }], pages: PAGES.filter(([n]) => ['home', 'topics', 'settings', 'review', 'quiz', 'word', 'search'].includes(n)) },
  { theme: 'ocean', mode: 'dark', size: SMALL, tag: '-reduced-transparency', media: [{ name: 'prefers-reduced-transparency', value: 'reduce' }], pages: PAGES.filter(([n]) => ['home', 'topics', 'settings', 'review', 'quiz', 'word', 'search'].includes(n)) },
  { theme: 'ocean', mode: 'light', size: SMALL, tag: '-reduced-motion', media: [{ name: 'prefers-reduced-motion', value: 'reduce' }], pages: PAGES.filter(([n]) => ['home', 'practice'].includes(n)) },
  { theme: 'sakura', mode: 'light', size: SMALL, tag: '-hsk6', settings: { hskOpen: 6 }, pages: [['word-旁', '#/word/旁', 'long meaning: UI text falling through Nunito to Kai'], ['word-大厦', '#/word/大厦', 'long meaning: UI text falling through Nunito to Kai'], ['topics', '#/topics', 'all HSK levels open']] },
];

try {
  for (const s of sets) if (!FILTER || FILTER === 'main' || `${s.theme}-${s.mode}-${s.size.width}${s.tag ?? ''}` === FILTER) await set(s);

  // Assistant window: frosted bubble on a transparent window, then on a busy desktop.
  const busy = 'repeating-linear-gradient(45deg, #111 0 10px, #fafafa 10px 20px), linear-gradient(90deg, #ff3b30, #34c759, #007aff)';
  const petShots = [
    ...['ocean', 'sakura', 'night', 'matcha'].flatMap((theme) => [['light', theme], ['dark', theme]]).filter(([m, t]) => !(t === 'night' && m === 'light') && !(t === 'matcha' && m === 'dark')).map(([mode, theme]) => ({ theme, mode })),
  ];
  if (!FILTER || FILTER === 'zoom') { await zooms('ocean', 'light'); await zooms('ocean', 'dark'); await zooms('sakura', 'light'); }
  if (!FILTER || FILTER === 'pet') for (const { theme, mode } of petShots) {
    const w = await h.open({ label: 'pet', seed: seedFor({ theme, mode, settings: { guessFirst: false, petScale: 3 } }) });
    const meta = (focus, state) => ({ window: 'pet', page: 'pet', focus, theme: THEME_NAME[theme], mode, size: 'window', state });
    try {
      await w.page.waitForSelector('.bubble .hanzi', { timeout: 20_000 });
      await w.page.waitForSelector('.bubble .vi', { timeout: 10_000 });
      await h.syncPet(w.page); await h.settle(w.page, 500);
      await shot(w.page, `pet-${theme}-${mode}`, meta('bubble (frosted, tail, shadow inside the window)', 'transparent window'));
      await busyShot(w.page, `pet-${theme}-${mode}-busy`, meta('bubble on a busy desktop: text must read', 'on busy desktop'), busy);
      if (theme === 'ocean') {
        await w.page.hover('.bubble .known'); await sleep(200);
        await shot(w.page, `pet-${theme}-${mode}-hover-known`, meta('"Biết rồi" hovered', 'hover'));
        const kb = await (await w.page.$('.bubble .known')).boundingBox();
        await w.page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await w.page.mouse.down(); await sleep(200);
        await shot(w.page, `pet-${theme}-${mode}-press-known`, meta('"Biết rồi" pressed', 'pressed'));
        await w.page.mouse.move(2, 2); await w.page.mouse.up(); await sleep(150);
        await w.page.keyboard.press('Shift'); await w.page.focus('.bubble .star'); await sleep(200);
        await shot(w.page, `pet-${theme}-${mode}-focus-star`, meta('notebook pill, keyboard focus', 'focus'));
        await w.page.evaluate(() => document.activeElement?.blur());
        await w.page.click('.sprite-slot', { button: 'right' }); await sleep(400);
        // The window may have grown with the bubble: mirror the app's size before looking.
        await h.syncPet(w.page); await h.settle(w.page, 200);
        await shot(w.page, `pet-${theme}-${mode}-menu`, meta('right-click menu (opaque, above the character)', 'menu open'));
        await w.page.hover('.menu button:nth-of-type(2)'); await sleep(200);
        await shot(w.page, `pet-${theme}-${mode}-menu-hover`, meta('menu row hovered', 'hover'));
        await w.page.mouse.move(2, 2); await w.page.keyboard.press('Shift'); await w.page.focus('.menu button:nth-of-type(3)'); await sleep(200);
        await shot(w.page, `pet-${theme}-${mode}-menu-focus`, meta('menu row, keyboard focus', 'focus'));
      }
    } finally { if (w.errors.length) errorsOut[`pet-${theme}-${mode}`] = w.errors; await w.close(); }
  }
  if (!FILTER || FILTER === 'pet') {
    for (const [tag, settings, media, focus, mode = 'light'] of [
      ['guess', { guessFirst: true }, [], 'guess state (meaning hidden) when a seen word comes up', 'dark'],
      ['guess', { guessFirst: true }, [], 'guess state (meaning hidden) when a seen word comes up'],
      ['bubble-only', { petSkinOn: false, guessFirst: false }, [], 'Skin off: plain bubble without tail'],
      ['skin-leaf', { petSkin: 'leaf', guessFirst: false }, [], 'skin Viền hoa lá: no character, flower border'],
      ['reduced-transparency', { guessFirst: false }, [{ name: 'prefers-reduced-transparency', value: 'reduce' }], 'solid bubble'],
      ['large', { guessFirst: false, petScale: 4 }, [], 'size Lớn'],
    ]) {
      const w = await h.open({ label: 'pet', media, seed: seedFor({ theme: 'ocean', mode, settings, progress: tag === 'guess' ? undefined : { exposure: {}, srs: {}, seenDays: {}, reviewDays: {} } }) });
      try {
        await w.page.waitForSelector('.bubble .hanzi', { timeout: 20_000 });
        await h.syncPet(w.page); await h.settle(w.page, 500);
        await shot(w.page, `pet-ocean-${mode}-${tag}`, { window: 'pet', page: 'pet', focus, theme: 'Biển xanh', mode, size: 'window', state: tag });
        if (tag === 'guess' && await w.page.$('.guess')) {
          await w.page.hover('.guess'); await sleep(200);
          await shot(w.page, `pet-ocean-${mode}-guess-hover`, { window: 'pet', page: 'pet', focus: 'guess pill hovered', theme: 'Biển xanh', mode, size: 'window', state: 'hover' });
          await w.page.mouse.down(); await sleep(150);
          await shot(w.page, `pet-ocean-${mode}-guess-press`, { window: 'pet', page: 'pet', focus: 'guess pill pressed', theme: 'Biển xanh', mode, size: 'window', state: 'pressed' });
          await w.page.mouse.move(2, 2); await w.page.mouse.up();
          // The bubble may have revealed the meaning by itself by now: focus the pill only if it is still there.
          if (await w.page.$('.guess')) {
            await w.page.keyboard.press('Shift'); await w.page.focus('.guess'); await sleep(200);
            await shot(w.page, `pet-ocean-${mode}-guess-focus`, { window: 'pet', page: 'pet', focus: 'guess pill, keyboard focus', theme: 'Biển xanh', mode, size: 'window', state: 'focus' });
          } else errorsOut[`pet-guess-focus-${mode}`] = ['the bubble revealed the meaning before the focus shot (not shot)'];
          // The bubble reveals the meaning by itself after a few seconds: click only if the guess pill is still there.
          if (await w.page.$('.guess')) await w.page.click('.guess'); await sleep(400);
          // Revealing grows the bubble and the window: mirror the new size before the shot.
          await h.syncPet(w.page); await h.settle(w.page, 300);
          await shot(w.page, `pet-ocean-${mode}-revealed`, { window: 'pet', page: 'pet', focus: 'revealed after the guess button', theme: 'Biển xanh', mode, size: 'window', state: 'revealed' });
        }
      } finally { if (w.errors.length) errorsOut[`pet-${tag}-${mode}`] = w.errors; await w.close(); }
    }
    // Nothing on: no topics, no levels, and no due or starred words either (those would still feed the bubble).
    for (const mode of ['light', 'dark']) {
    const w = await h.open({ label: 'pet', seed: seedFor({ theme: 'ocean', mode, settings: { topics: [], hsk: [] }, progress: { exposure: {}, srs: {}, seenDays: {}, reviewDays: {} } }) });
    try {
      const nap = await w.page.waitForSelector('.nap', { timeout: 20_000 }).catch(() => null);
      if (nap) {
        await h.syncPet(w.page); await h.settle(w.page, 400);
        await shot(w.page, `pet-ocean-${mode}-nap`, { window: 'pet', page: 'pet', focus: 'nothing turned on: the nap pill', theme: 'Biển xanh', mode, size: 'window', state: 'nap' });
        await w.page.hover('.nap'); await sleep(200);
        await shot(w.page, `pet-ocean-${mode}-nap-hover`, { window: 'pet', page: 'pet', focus: 'nap pill hovered', theme: 'Biển xanh', mode, size: 'window', state: 'hover' });
        const nr = await (await w.page.$('.nap')).boundingBox();
        await w.page.mouse.move(nr.x + nr.width / 2, nr.y + nr.height / 2); await w.page.mouse.down(); await sleep(200);
        await shot(w.page, `pet-ocean-${mode}-nap-press`, { window: 'pet', page: 'pet', focus: 'nap pill pressed', theme: 'Biển xanh', mode, size: 'window', state: 'pressed' });
        await w.page.mouse.move(2, 2); await w.page.mouse.up(); await sleep(150);
        await w.page.keyboard.press('Shift'); await w.page.focus('.nap'); await sleep(200);
        await shot(w.page, `pet-ocean-${mode}-nap-focus`, { window: 'pet', page: 'pet', focus: 'nap pill, keyboard focus', theme: 'Biển xanh', mode, size: 'window', state: 'focus' });
        await w.page.evaluate(() => document.activeElement?.blur());
        await busyShot(w.page, `pet-ocean-${mode}-nap-busy`, { window: 'pet', page: 'pet', focus: 'nap pill on a busy desktop', theme: 'Biển xanh', mode, size: 'window', state: 'on busy desktop' }, busy);
      } else errorsOut[`pet-nap-${mode}`] = ['no .nap within 20 s with topics [] and hsk [] (state not shot)'];
    } finally { if (w.errors.length) errorsOut[`pet-nap-${mode}`] = w.errors; await w.close(); }
    }
  }
} finally {
  await h.close();
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(OUT, 'errors.json'), JSON.stringify(errorsOut, null, 2));
console.log(`${manifest.length} screenshots in ${OUT}; console errors in ${Object.keys(errorsOut).length} contexts`);
if (Object.keys(errorsOut).length) { console.log(JSON.stringify(errorsOut, null, 2)); process.exit(1); }
