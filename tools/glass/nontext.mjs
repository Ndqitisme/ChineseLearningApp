// Non-text contrast (WCAG 1.4.11 at 3:1, and the focus comparison of 2.4.13): colours that carry meaning, measured on
// the rendered pixels with all text hidden. Each check compares the median colour of two small regions:
//   fill   progress fills (HSK lessons, topic cards, quiz) and the slider fill, against their track and the surface
//   switch an on switch's track against the surface beside it
//   ring   state rings (selected topic, right/wrong answer, scored tiles, picked/right/wrong tones, selected swatch,
//          the four grade pills on a flipped review card) against what lies just outside them; a pill's ring is read on its
//          top edge, where it runs straight
//   focus  a focus ring's pixels against the same pixels unfocused
//   icon   every icon on a pill, chip or card, on every main page and scroll step, at 1120 and 860 wide: the core of its
//          rendered stroke (the pixel that differs most from the same pixel with the icon hidden) against the hardest
//          backdrop in its box with the icon hidden (3x3 averages, as contrast.mjs does). The rendered ink, not the
//          declared colour: thin mask strokes never reach their colour, and the backdrop behind a thin pill varies.
//   board  the Viet theo net board (quiz, outline on): each drawn stroke up to the first radical stroke (hanzi-writer draws
//          those in radicalColor), the learner's ink while a stroke is being dragged, and the hint flash at its peak (the
//          page clock is frozen there), each against the board and against the ghost character under it. The colour is
//          the median of the stroke's core (pixels that changed most when it appeared); the board is the same pixels with
//          the board's svg hidden, the ghost the same pixels just before.
// Usage: GLASS=refract|fallback|reduced [ONLY=sakura-light,...] [STEPS=pages,quiz,build,tones,review,focus,icons,board] node nontext.mjs [out.json]
import { writeFileSync } from 'node:fs';
import { WORK, seedFor, sleep, start } from './harness.mjs';

const GLASS = process.env.GLASS ?? 'refract';
const OUT = process.argv[2] ?? `${WORK}/nontext-${GLASS}.json`;
const QUERY = GLASS === 'fallback' ? '?glass=fallback' : '';
const MEDIA = GLASS === 'reduced' ? [{ name: 'prefers-reduced-transparency', value: 'reduce' }] : [];
const COMBOS = [];
for (const theme of ['sakura', 'matcha', 'boba', 'ocean', 'night']) for (const mode of ['light', 'dark']) COMBOS.push({ theme, mode });
if (process.env.ONLY) COMBOS.splice(0, COMBOS.length, ...COMBOS.filter((c) => process.env.ONLY.split(',').includes(`${c.theme}-${c.mode}`)));
const HIDE = '* { transition: none !important; animation: none !important; color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } .icon { visibility: hidden !important; } img, canvas, .stroke svg { visibility: hidden !important; } ::selection { background: transparent !important; }';

/** In the page: sample regions for the fills, switches and rings currently visible. */
function regions() {
  const out = [];
  const vis = (r) => r.width > 0 && r.height > 0 && r.bottom > 40 && r.top < innerHeight - 4 && r.left >= 0 && r.right <= innerWidth;
  const box = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) });
  for (const f of document.querySelectorAll('.progress i, .bar i, .range .fill')) {
    const F = f.getBoundingClientRect(), T = f.parentElement.getBoundingClientRect();
    if (!vis(T) || F.width < 8) continue;
    const knob = f.classList.contains('fill') ? 9 : 0;
    const fill = box(F.left + 3, T.top + T.height / 2 - 1, Math.min(F.width - 6 - knob, 30), 2);
    const trackX = F.right + knob + 3, trackW = T.right - 3 - trackX;
    const name = f.closest('.lp') ? 'lesson progress' : f.closest('.bar') ? 'topic progress' : f.classList.contains('fill') ? 'slider fill' : 'progress';
    if (trackW >= 4) out.push({ kind: 'fill', name: `${name} vs track`, a: fill, b: box(trackX, T.top + T.height / 2 - 1, Math.min(trackW, 30), 2) });
    out.push({ kind: 'fill', name: `${name} vs surface`, a: fill, b: box(T.left + 4, T.top - 5, Math.min(T.width - 8, 40), 2) });
  }
  for (const s of document.querySelectorAll('.switch:has(:checked):not(.disabled)')) {
    const S = s.getBoundingClientRect(); if (!vis(S)) continue;
    out.push({ kind: 'switch', name: `switch on${s.closest('nav') ? ' (sidebar)' : ''}`, a: box(S.left + 4, S.top + S.height / 2 - 2, 5, 4), b: box(S.left - 5, S.top + S.height / 2 - 2, 2, 4) });
  }
  const rings = [['.topic.on', 'selected topic ring', 1], ['.option.right', 'right answer ring', 1], ['.option.wrong', 'wrong answer ring', 1], ['.tile.ok', 'right tile ring', 1], ['.tile.off', 'misplaced tile ring', 1], ['.tone.right', 'right tone ring', 1], ['.tone.wrong', 'wrong tone ring', 1], ['.theme.on', 'selected swatch ring', -4]];
  for (const [sel, name, dx] of rings) for (const e of document.querySelectorAll(sel)) {
    const R = e.getBoundingClientRect(); if (!vis(R)) continue;
    const y = R.top + R.height * 0.35, h = R.height * 0.3;
    out.push({ kind: 'ring', name, a: box(R.left + dx, y, 1, h), b: box(R.left + Math.min(dx, 0) - 4, y, 1, h) });
    break;
  }
  // Grade pills: the 2px ring inset at the top edge (its inner row), against the backdrop 6px above the pill.
  for (const sel of ['.grades .again', '.grades .hard', '.grades .good', '.grades .easy']) for (const e of document.querySelectorAll(sel)) {
    const R = e.getBoundingClientRect(); if (!vis(R)) continue;
    out.push({ kind: 'ring', name: `grade ring ${sel.split('.').pop()}`, a: box(R.left + R.width / 2 - 15, R.top + 1, 30, 1), b: box(R.left + R.width / 2 - 15, R.top - 6, 30, 1) });
    break;
  }
  // The picked tone's bar under the button, against the card face below it.
  for (const e of document.querySelectorAll('.tone.on')) {
    const R = e.getBoundingClientRect(); if (!vis(R)) continue;
    out.push({ kind: 'mark', name: 'picked tone bar', a: box(R.left + R.width / 2 - 4, R.bottom + 5, 8, 2), b: box(R.left + R.width / 2 - 4, R.bottom + 11, 8, 2) });
    break;
  }
  return out;
}

/** In the page: median colours of each region pair in one screenshot, and their contrast. */
async function measure(b64, items, b64b) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g; };
  const A = await load(b64), B = b64b ? await load(b64b) : A;
  const med = (g, r) => { const d = g.getImageData(r.x, r.y, r.w, r.h).data; const ch = [[], [], []]; for (let i = 0; i < d.length; i += 4) { ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2]); } return ch.map((v) => v.sort((p, q) => p - q)[v.length >> 1]); };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return items.map((it) => { const a = med(A, it.a), b = med(B, it.b ?? it.a); const x = lum(a), y = lum(b); return { ...it, ca: a, cb: b, ratio: +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2) }; });
}

const FOCUS = [
  ['#/topics', '.topic .body'], ['#/topics', '.topic .bell:not(.on)'], ['#/topics', '.bell.on'], ['#/topic/greetings', '.actions input'], ['#/topic/greetings', '.actions .btn'],
  ['#/topic/greetings', 'a.row'], ['#/topic/greetings', '.back-btn'], ['#/settings', '.chip'], ['#/settings', '.content .switch input'],
  ['#/settings', '.select-trigger'], ['#/settings', '.theme:not(.on)'], ['#/settings', '.theme.on'], ['#/settings', '.range input'], ['#/settings', 'input[type=time]'],
  ['#/quiz/meaning', '.option'], ['#/review', '.flash'], ['#/build/order', '.pool .tile'], ['#/build/order', '.tabs .chip'],
  ['#/tones', '.syl .tone'], ['#/practice', '.mode'], ['#/', '.side a'],
];

const STEPS = (process.env.STEPS ?? 'pages,quiz,build,tones,review,focus,icons,board').split(',');
const h = await start();
const results = [];
const go = async (p, hash) => { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForFunction((x) => decodeURIComponent(location.hash) === x && document.querySelector('.page'), { timeout: 15000 }, hash); await h.settle(p, 450); };
const SETTLE = '* { transition: none !important; animation: none !important; } ::selection { background: transparent !important; }';
const plain = async (p) => { const s = await p.addStyleTag({ content: SETTLE }); await sleep(60); const b = await p.screenshot({ encoding: 'base64' }); await s.evaluate((n) => n.remove()); await sleep(80); return b; };
const ICON_PAGES = ['#/', '#/topics', '#/topic/greetings', '#/hsk/1', '#/word/你好', '#/practice', '#/quiz/meaning', '#/review', '#/write', '#/build/order', '#/tones', '#/search/ni', '#/notebook', '#/settings', '#/about', '#/support'];

/** In the page: icons on pills, chips and cards in view. */
function iconRegions() {
  const out = [];
  for (const e of document.querySelectorAll('.icon')) {
    const host = e.closest('.btn, .chip, .card, .mode, .glass, .glass-soft');
    if (!host || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const R = e.getBoundingClientRect();
    if (R.width < 8 || R.top < 40 || R.bottom > innerHeight - 2 || R.left < 0 || R.right > innerWidth) continue;
    out.push({ kind: 'icon', name: `icon ${e.style.getPropertyValue('--src').replace(/url\(\/icons\/|\.png\)/g, '')} on ${host.tagName.toLowerCase()}.${[...host.classList].filter((c) => !c.startsWith('svelte')).slice(0, 3).join('.')}`, r: { x: Math.floor(R.left), y: Math.floor(R.top), w: Math.ceil(R.width), h: Math.ceil(R.height) } });
  }
  return out;
}

/** In the page: per icon, its stroke core (the pixel that changes most when the icon is drawn) against the hardest
 *  backdrop in its box without it (3x3 averages). */
async function iconContrast(onB64, offB64, items) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g; };
  const A = await load(onB64), B = await load(offB64);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  return items.map((it) => {
    const a = A.getImageData(it.r.x, it.r.y, it.r.w, it.r.h).data, b = B.getImageData(it.r.x, it.r.y, it.r.w, it.r.h).data;
    let core = 1, ci = 0;
    for (let i = 0; i < a.length; i += 4) {
      const x = lum(a, i), y = lum(b, i), q = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      if (q > core) { core = q; ci = i; }
    }
    const ink = lum(a, ci), W = it.r.w, H = it.r.h;
    let worst = Infinity, cb = null;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let r0 = 0, g0 = 0, b0 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = ((y + dy) * W + (x + dx)) * 4; r0 += b[o]; g0 += b[o + 1]; b0 += b[o + 2]; }
      const bg = [r0 / 9, g0 / 9, b0 / 9], l = lum(bg, 0), q = (Math.max(ink, l) + 0.05) / (Math.min(ink, l) + 0.05);
      if (q < worst) { worst = q; cb = bg.map(Math.round); }
    }
    return { kind: it.kind, name: it.name, a: it.r, ca: [a[ci], a[ci + 1], a[ci + 2]], cb, ratio: +(core > 1 ? worst : 1).toFixed(2) };
  });
}
const shot = async (p) => { const s = await p.addStyleTag({ content: HIDE }); await sleep(60); const b = await p.screenshot({ encoding: 'base64' }); await s.evaluate((n) => n.remove()); await sleep(80); return b; };

/** In the page: the core of what appeared between `before` and `after` inside `box` (pixels whose change is at least 60 %
 *  of the largest), and the median colours there in `after`, `before` and `bare` (the board without its svg). */
async function boardCore(afterB64, beforeB64, bareB64, box) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(box.x, box.y, box.w, box.h).data; };
  const A = await load(afterB64), B = await load(beforeB64), C = await load(bareB64);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  const q = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  const qs = []; let top = 1;
  for (let i = 0; i < A.length; i += 4) { const v = q(lum(A, i), lum(B, i)); qs.push(v); if (v > top) top = v; }
  const core = []; for (let k = 0; k < qs.length; k++) if (top > 1.2 && qs[k] >= 1 + (top - 1) * 0.6) core.push(k * 4);
  if (!core.length) return { n: 0 };
  const med = (d) => [0, 1, 2].map((c) => core.map((i) => d[i + c]).sort((x, y) => x - y)[core.length >> 1]);
  const a = med(A), b = med(B), c = med(C), L = (v) => lum(v, 0);
  return { n: core.length, drawn: a, ghost: b, board: c, vsBoard: +q(L(a), L(c)).toFixed(2), vsGhost: +q(L(a), L(b)).toFixed(2) };
}

/** The writing board in quiz mode: drawn strokes, the learner's ink and the hint flash, against the board and the ghost. */
async function boardStep(theme, mode) {
  const w = await h.open({ hash: '#/write', query: QUERY, media: MEDIA, size: { width: 1120, height: 760 }, seed: seedFor({ theme, mode, settings: { writeDemo: false } }) });
  const p = w.page;
  const out = (name, m, box) => results.push({ theme, mode, glass: GLASS, page: '#/write board', kind: 'board', name, a: box, ca: m.drawn, cb: name.endsWith('ghost') ? m.ghost : m.board, ratio: m.n ? (name.endsWith('ghost') ? m.vsGhost : m.vsBoard) : 0, core: m.n });
  try {
    // A clock the page can freeze: hanzi-writer starts a tween at performance.now() and advances it by the rAF timestamp.
    await p.evaluateOnNewDocument(() => {
      const real = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window);
      window.__frozen = null;
      // A fixed shuffle, so every theme gets the same deck and the same first character.
      let seed = Number(window.__boardSeed ?? 7);
      Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      performance.now = () => window.__frozen ?? real();
      window.requestAnimationFrame = (cb) => raf((t) => cb(window.__frozen ?? t));
    });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.layout .stroke svg path', { timeout: 30000 });
    await h.settle(p, 700);
    await p.mouse.move(1, 1);
    const geo = await p.evaluate(async () => {
      const el = document.querySelector('.layout .stroke'); el.scrollIntoView({ block: 'center' });
      const char = el.getAttribute('aria-label').split(' ').pop();
      const data = await (await fetch(`/strokes/${encodeURIComponent(char)}.json`)).json();
      const m = el.querySelector('svg g[transform]').getScreenCTM();
      const toScreen = ([x, y]) => { const q = new DOMPoint(x, y).matrixTransform(m); return [q.x, q.y]; };
      const r = el.getBoundingClientRect();
      return { char, rad: data.radStrokes ?? [], medians: data.medians.map((s) => s.map(toScreen)), box: { x: Math.round(r.left) + 3, y: Math.round(r.top) + 3, w: Math.round(r.width) - 6, h: Math.round(r.height) - 6 } };
    });
    const bare = await shot(p);
    const drag = async (pts, release = true) => {
      await p.mouse.move(pts[0][0], pts[0][1]); await p.mouse.down();
      for (let k = 1; k < pts.length; k++) for (let t = 1; t <= 6; t++) await p.mouse.move(pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t / 6, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t / 6);
      if (release) await p.mouse.up();
    };
    // Drawn strokes: 0 up to the first radical stroke.
    const last = Math.max(0, Math.min(geo.medians.length - 1, geo.rad.length ? Math.min(...geo.rad) : 0));
    let k = 0;
    for (; k <= last; k++) {
      const before = await plain(p);
      await drag(geo.medians[k]); await p.mouse.move(1, 1); await sleep(1400);
      const m = await p.evaluate(boardCore, await plain(p), before, bare, geo.box);
      const tag = `board ${geo.char} stroke ${k}${geo.rad.includes(k) ? ' (radical)' : ''}`;
      out(`${tag} vs board`, m, geo.box); out(`${tag} vs ghost`, m, geo.box);
    }
    if (k < geo.medians.length) {
      // The learner's ink, held mid-drag.
      const before = await plain(p);
      await drag(geo.medians[k], false); await sleep(120);
      const m = await p.evaluate(boardCore, await plain(p), before, bare, geo.box);
      await p.mouse.up(); await p.mouse.move(1, 1); await sleep(1400);
      out(`board ${geo.char} ink (stroke ${k}) vs board`, m, geo.box); out(`board ${geo.char} ink (stroke ${k}) vs ghost`, m, geo.box);
      k++;
    }
    if (k < geo.medians.length) {
      // The hint flash at its peak.
      const before = await plain(p);
      // The tween starts a few microtasks after the click, at the frozen time; then the clock jumps past its end, and
      // the fade-out that follows starts at the new time and stays at full opacity.
      await p.evaluate(async () => { window.__frozen = performance.now(); [...document.querySelectorAll('.layout button')].find((x) => x.textContent.includes('Gợi ý')).click(); await new Promise((r) => setTimeout(r, 80)); window.__frozen += 5000; });
      await sleep(300);
      const m = await p.evaluate(boardCore, await plain(p), before, bare, geo.box);
      await p.evaluate(() => { window.__frozen = null; });
      out(`board ${geo.char} hint (stroke ${k}) vs board`, m, geo.box); out(`board ${geo.char} hint (stroke ${k}) vs ghost`, m, geo.box);
    }
  } finally { await w.close(); }
}
async function sweep(p, push) {
  const steps = await p.evaluate(() => { const c = document.querySelector('main.content'); return Math.max(1, Math.ceil((c.scrollHeight - c.clientHeight) / (c.clientHeight * 0.8)) + 1); });
  for (let k = 0; k < steps; k++) {
    await p.evaluate((k) => { const c = document.querySelector('main.content'); c.scrollTop = k * c.clientHeight * 0.8; }, k); await sleep(120);
    const items = await p.evaluate(regions); if (!items.length) continue;
    for (const m of await p.evaluate(measure, await shot(p), items)) push(m);
  }
}
try {
  for (const { theme, mode } of COMBOS) {
    const w = await h.open({ hash: '#/', query: QUERY, media: MEDIA, size: { width: 1120, height: 760 }, seed: seedFor({ theme, mode }) });
    const p = w.page;
    const push = (page) => (m) => results.push({ theme, mode, glass: GLASS, page, ...m });
    try {
      if (STEPS.includes('pages')) for (const hash of ['#/', '#/topics', '#/hsk/1', '#/settings']) { await go(p, hash); await sweep(p, push(hash)); }
      if (STEPS.includes('quiz')) {
        await go(p, '#/quiz/meaning'); await p.click('.option'); await sleep(400); await sweep(p, push('quiz answered'));
        await p.keyboard.press('Enter'); await sleep(400); await sweep(p, push('quiz question 2'));
      }
      if (STEPS.includes('build')) {
        await go(p, '#/build/order'); for (const t of await p.$$('.pool .tile:not(.used)')) await t.click(); await sleep(200);
        await p.click('.actions .btn.primary'); await sleep(400); await sweep(p, push('build result'));
      }
      if (STEPS.includes('tones')) {
        await go(p, '#/tones'); for (const s of await p.$$('.syl')) await (await s.$('.tone')).click(); await sleep(250); await sweep(p, push('tones picked'));
        await p.click('.drill .btn.primary'); await sleep(400); await sweep(p, push('tones checked'));
      }
      if (STEPS.includes('review')) { await go(p, '#/review'); await p.click('.flash'); await sleep(450); await sweep(p, push('review flipped')); }
      // Focus rings: the ring's pixels focused against the same pixels unfocused.
      for (const [hash, sel] of STEPS.includes('focus') ? FOCUS : []) {
        await go(p, hash);
        const ok = await p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return false; e.scrollIntoView({ block: 'center' }); return true; }, sel);
        if (!ok) continue;
        await p.mouse.move(1, 1); await sleep(150);
        const before = await shot(p);
        // Keyboard focus: script focus, Tab away, Shift+Tab back (script focus alone can land on a control that already
        // holds focus without the keyboard, which shows no ring).
        await p.evaluate((sel) => document.querySelector(sel).focus({ preventScroll: true }), sel);
        await p.keyboard.press('Tab'); await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
        await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), sel); await sleep(250);
        const spec = await p.evaluate((sel) => {
          const e = document.querySelector(sel);
          const hosts = [e, e.closest('.switch, .range, .topic, .glass-focus'), e.parentElement].filter(Boolean);
          for (const n of hosts) {
            const c = getComputedStyle(n), wid = parseFloat(c.outlineWidth), off = parseFloat(c.outlineOffset);
            if (parseFloat(c.opacity) === 0) continue; // the switch's hidden checkbox: its ring cannot be seen
            if (c.outlineStyle !== 'none' && wid > 0) return { host: n.className.toString().slice(0, 40), r: n.getBoundingClientRect().toJSON(), d: off + wid / 2 };
          }
          const rg = e.closest('.range'); if (rg) return { host: 'range (shadow ring)', r: rg.getBoundingClientRect().toJSON(), d: 3 };
          return null;
        }, sel);
        if (spec) {
          const x = Math.round(spec.d >= 0 ? spec.r.left - spec.d : spec.r.left - spec.d - 1);
          const y = spec.r.top + spec.r.height * 0.35, hgt = Math.max(1, spec.r.height * 0.3);
          const item = { kind: 'focus', name: `focus ring ${sel} (${spec.host})`, a: { x, y: Math.round(y), w: 1, h: Math.round(hgt) } };
          const [m] = await p.evaluate(measure, await shot(p), [item], before);
          results.push({ theme, mode, glass: GLASS, page: hash, ...m });
        } else results.push({ theme, mode, glass: GLASS, page: hash, kind: 'focus', name: `focus ring ${sel}: no ring found`, ratio: 0 });
        await p.evaluate(() => document.activeElement?.blur());
      }
      // Icons on pills, chips and cards, every main page, every scroll step, at both window widths.
      for (const size of STEPS.includes('icons') ? [{ width: 1120, height: 760 }, { width: 860, height: 600 }] : []) for (const hash of ICON_PAGES) {
        if (p.viewport().width !== size.width) await p.setViewport(size);
        await go(p, hash);
        const steps = await p.evaluate(() => { const c = document.querySelector('main.content'); return Math.max(1, Math.ceil((c.scrollHeight - c.clientHeight) / (c.clientHeight * 0.8)) + 1); });
        for (let k = 0; k < steps; k++) {
          await p.evaluate((k) => { const c = document.querySelector('main.content'); c.scrollTop = k * c.clientHeight * 0.8; }, k); await sleep(120);
          await p.mouse.move(1, 1);
          const items = await p.evaluate(iconRegions); if (!items.length) continue;
          const on = await plain(p), off = await shot(p);
          for (const m of await p.evaluate(iconContrast, on, off, items)) results.push({ theme, mode, glass: GLASS, page: `${hash} ${size.width}`, ...m });
        }
      }
    } finally { await w.close(); }
    if (STEPS.includes('board')) await boardStep(theme, mode);
    console.log(GLASS, theme, mode, results.length);
  }
} finally { await h.close(); }
writeFileSync(OUT, JSON.stringify(results, null, 1));
const fails = results.filter((r) => r.ratio < 3);
console.log(`\n${results.length} non-text checks, ${fails.length} below 3:1`);
const seen = new Map();
for (const f of fails) { const k = `${f.theme} ${f.mode} ${f.glass} | ${f.page} | ${f.name}`; if (!seen.has(k) || seen.get(k).ratio > f.ratio) seen.set(k, f); }
for (const f of [...seen.values()].sort((a, b) => a.ratio - b.ratio)) console.log(`${f.ratio.toFixed(2)} (need 3) ${f.theme} ${f.mode} ${f.glass} | ${f.page} | ${f.name} | rgb(${f.ca}) vs rgb(${f.cb})`);
