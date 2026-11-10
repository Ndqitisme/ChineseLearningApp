// Interaction states of every interactive element. On each page (and the pet window) it discovers every element a user
// can operate: button, a[href], summary, select, textarea, input (an invisible native input stands for its visible
// switch or slider), [role=button|switch|tab|option], [tabindex>=0], labels wrapping a switch (they stand for the
// switch), and anything else with cursor: pointer. Elements are grouped by component and state: tag + every class
// (state classes included: an on chip and an off chip are different faces) + checked / pressed / selected / current /
// disabled; one sample per group per page. Each sample is recorded at rest, hovered, pressed (button held) and with
// keyboard focus. The face is measured in the element's padding: inside its box (inset past the rim and the press
// scale, corners excluded by its own radius), outside every text run, icon, image and child with its own fill, each
// grown by 2px. The same rules hold for every sample:
//   hover    the face median moves at least HOVER levels from rest, either way
//   press    differs from hover: scale under 1, a rim/shadow change, or a pixel change
//   press    in dark themes the face median is at least SINK levels darker than at rest (a switch: its track beside the
//            knob, on and off)
//   focus    reached with a real Tab press (Tab away, Shift+Tab back); exactly one ring among the element, its hosts
//            and its descendants: 2px wide, 2px out (list rows inside a card: one ring inset, concentric with the card);
//            the ring is drawn (along its middle line at least half the pixels change); it does not cross its card or
//            touch another control
//   switch   the press keeps the knob row as sharp as at rest (largest neighbour step at least 75 % of the resting one)
//   disabled no change on hover or press
//   dark     no pure-white top rim on hover (the 0.75 cap)
// Classes exempt from a rule, with the reason, are in EXEMPT below; every exemption is printed with the results.
// PAGES=#/settings,#/ limits the main-window pages; PET_ONLY=1 samples only the pet window; NORING=1 makes every outline
// transparent, to show the drawn-ring check fails when nothing is drawn.
// Usage: [ONLY=ocean-light,ocean-dark,night-dark] node states.mjs [out.json]
import { writeFileSync } from 'node:fs';
import { WORK, seedFor, sleep, start } from './harness.mjs';

const OUT = process.argv[2] ?? `${WORK}/states.json`;
const COMBOS = (process.env.ONLY ?? 'ocean-light,ocean-dark,night-dark').split(',').map((s) => { const [theme, mode] = s.split('-'); return { theme, mode }; });
const PAGES = [
  ['#/', null], ['#/topics', null], ['#/topic/greetings', null], ['#/hsk/1', null], ['#/word/你好', null], ['#/practice', null],
  ['#/quiz/meaning', null], ['#/quiz/meaning', 'answer'], ['#/review', null], ['#/review', 'flip'], ['#/write', null],
  ['#/build/order', null], ['#/build/order', 'result'], ['#/tones', null], ['#/tones', 'check'], ['#/search/ni', null],
  ['#/notebook', null], ['#/settings', null], ['#/about', null], ['#/support', null],
];
const PREP = {
  answer: async (p) => { await p.click('.option'); await sleep(400); },
  flip: async (p) => { await p.click('.flash'); await sleep(400); },
  result: async (p) => { for (const t of await p.$$('.pool .tile:not(.used)')) await t.click(); await sleep(200); await p.click('.actions .btn.primary'); await sleep(400); },
  check: async (p) => { for (const s of await p.$$('.syl')) await (await s.$('.tone')).click(); await sleep(200); await p.click('.drill .btn.primary'); await sleep(400); },
};

/** In the page: one sample per component and state. Marks each with data-st="<n>" and returns descriptions. */
function enumerate() {
  const base = 'a[href], button, summary, select, textarea, input:not([type=hidden]), [role=button], [role=switch], [role=tab], [role=option]';
  const found = new Set([...document.querySelectorAll(base), ...[...document.querySelectorAll('[tabindex]')].filter((el) => el.tabIndex >= 0)]);
  for (const l of document.querySelectorAll('label')) { const sw = l.querySelector('.switch'); if (sw) found.add(sw); }
  for (const el of document.querySelectorAll('body *')) if (getComputedStyle(el).cursor === 'pointer' && !el.closest(base) && !el.closest('label')) found.add(el);
  const out = [], seen = new Set();
  document.querySelectorAll('[data-st]').forEach((n) => n.removeAttribute('data-st'));
  for (let el of found) {
    // An invisible native input stands for its visible control (switch, slider).
    if (el.tagName === 'INPUT' && parseFloat(getComputedStyle(el).opacity) === 0) el = el.closest('.switch, .range') ?? el;
    if (el.tagName === 'LABEL' && el.querySelector('input, .switch')) continue;
    if (el.closest('.tip') || el.closest('[aria-hidden=true]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    const input = el.matches('input') ? el : el.querySelector('input');
    const flags = [input?.checked && 'checked', el.getAttribute('aria-pressed') === 'true' && 'pressed', el.getAttribute('aria-selected') === 'true' && 'selected',
      el.hasAttribute('aria-current') && 'current', (el.disabled || el.getAttribute('aria-disabled') === 'true') && 'disabled'].filter(Boolean);
    const cls = [...el.classList].filter((c) => c !== 'glass-on' && c !== 'glass-hover').sort().join('.');
    const key = `${el.tagName.toLowerCase()}${el.tagName === 'INPUT' ? `[${el.type}]` : ''}.${cls}${flags.map((f) => ':' + f).join('')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cs = getComputedStyle(el);
    const glassy = /glass|btn|chip|card|tile|tone|option|switch|range|theme|row|select-trigger|nap|guess|speak|known|star|hanzi/.test(el.className.toString()) || el.closest('.side') && el.tagName === 'A';
    const textLink = !glassy && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.boxShadow === 'none' && cs.backgroundImage === 'none' && (el.tagName === 'A' || el.classList.contains('link'));
    const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('off') && el.classList.contains('mode') || el.classList.contains('disabled'));
    el.setAttribute('data-st', String(out.length));
    out.push({ key, label: (el.textContent || el.getAttribute('aria-label') || el.title || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 30), disabled, textLink, switch: el.matches('.switch'), caption: !!el.closest('.titlebar') });
  }
  return out;
}

/** In the page: the face of sample i, as points relative to the clip origin. Inside the element's rounded box inset past
 *  its rim and the press scale; outside every text run, icon, image and child with its own fill (grown by 2px). A text
 *  field also leaves out the middle 40 % of its height (value, placeholder, caret, a time field's highlighted segment). */
function regionOf(i, clip, loose = false) {
  const el = document.querySelector(`[data-st="${i}"]`);
  const R = el.getBoundingClientRect(), cs = getComputedStyle(el);
  // The press scale (0.96) moves each edge in by 2 % of that dimension.
  const ix = loose ? 2 : Math.ceil(3 + 0.02 * R.width), iy = loose ? 2 : Math.ceil(3 + 0.02 * R.height);
  const rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, R.width / 2, R.height / 2);
  const holes = [];
  const grow = (b, m = loose ? 0 : 2) => ({ l: b.left - m, t: b.top - m, r: b.right + m, b: b.bottom + m });
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const b of rg.getClientRects()) if (b.width && b.height) holes.push(grow(b));
  }
  const area = R.width * R.height;
  for (const d of el.querySelectorAll('*')) {
    const b = d.getBoundingClientRect(); if (!b.width || !b.height || b.width * b.height > 0.7 * area) continue;
    if (!d.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    const s = getComputedStyle(d);
    // A fill that is transparent at rest (a row's hover face) is not content.
    const bg = s.backgroundColor, am = bg.match(/\/\s*([\d.]+)\s*\)$/) ?? bg.match(/^rgba\(.*,\s*([\d.]+)\)$/), alpha = bg === 'transparent' ? 0 : am ? +am[1] : 1;
    const filled = alpha > 0 || s.backgroundImage !== 'none' || s.maskImage !== 'none' || s.webkitMaskImage !== 'none';
    if (filled || /^(svg|img|canvas|video)$/i.test(d.tagName) || !d.children.length && d.textContent.trim()) holes.push(grow(b));
  }
  if (el.matches('input:not([type=checkbox]):not([type=range]):not([type=color]), textarea, select')) holes.push({ l: R.left, r: R.right, t: R.top + R.height * 0.3, b: R.bottom - R.height * 0.3 });
  const pts = [];
  const cx = R.left + R.width / 2, cy = R.top + R.height / 2;
  const step = Math.max(1, Math.round(Math.sqrt(area / 6000)));
  for (let y = Math.ceil(R.top + iy); y < R.bottom - iy; y += step) for (let x = Math.ceil(R.left + ix); x < R.right - ix; x += step) {
    const px = x + 0.5, py = y + 0.5;
    const qx = Math.max(0, Math.abs(px - cx) - (R.width / 2 - rad)), qy = Math.max(0, Math.abs(py - cy) - (R.height / 2 - rad));
    if (rad && Math.hypot(qx, qy) > rad - Math.min(ix, iy)) continue;
    if (holes.some((h) => px >= h.l && px <= h.r && py >= h.t && py <= h.b)) continue;
    pts.push([Math.floor(x - clip.x), Math.floor(y - clip.y)]);
  }
  return pts;
}

/** In the page: median luma of the face points in each clip. */
async function faceMed(shots, pts) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
  const out = [];
  for (const s of shots) {
    const D = await load(s), v = [];
    for (const [x, y] of pts) { if (x < 0 || y < 0 || x >= D.width || y >= D.height) continue; const i = (y * D.width + x) * 4; v.push(0.299 * D.data[i] + 0.587 * D.data[i + 1] + 0.114 * D.data[i + 2]); }
    v.sort((p, q) => p - q); out.push(v.length ? v[v.length >> 1] : NaN);
  }
  return out;
}

/** In the page: computed snapshot of the sample, plus every outline among its hosts and descendants (for focus). */
function snapshot(i) {
  const el = document.querySelector(`[data-st="${i}"]`);
  const c = getComputedStyle(el);
  const m = c.transform.match(/matrix\(([^,]+),/); const scale = m ? parseFloat(m[1]) : 1;
  const rings = [];
  const consider = [el, ...el.querySelectorAll('*'), el.parentElement, el.parentElement?.parentElement].filter(Boolean);
  for (const n of consider) {
    const s = getComputedStyle(n);
    if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && n.checkVisibility({ opacityProperty: true })) {
      let card = n.parentElement;
      while (card && card !== document.body && !(parseFloat(getComputedStyle(card).borderTopLeftRadius) > 0 && /card|glass|side|lesson|list/.test(card.className.toString()))) card = card.parentElement;
      if (card === document.body) card = null;
      const R = n.getBoundingClientRect(), wid = parseFloat(s.outlineWidth), off = parseFloat(s.outlineOffset), out = off + wid;
      const ring = { left: R.left - out, top: R.top - out, right: R.right + out, bottom: R.bottom + out };
      let gap = Infinity;
      for (const o of document.querySelectorAll('a[href], button, summary, input, [role=button], [tabindex]:not([tabindex="-1"])')) {
        if (o === n || o.contains(n) || n.contains(o) || !o.checkVisibility()) continue;
        const b = o.getBoundingClientRect(); if (b.width < 2) continue;
        const dx = Math.max(b.left - ring.right, ring.left - b.right, 0), dy = Math.max(b.top - ring.bottom, ring.top - b.bottom, 0);
        if (dx === 0 && dy === 0) { gap = Math.min(gap, -1); continue; }
        if (dx === 0 || dy === 0) gap = Math.min(gap, Math.max(dx, dy));
      }
      let cardInfo = null;
      if (card) {
        const C = card.getBoundingClientRect(), cr = parseFloat(getComputedStyle(card).borderTopLeftRadius);
        const inside = R.left >= C.left && R.right <= C.right && R.top >= C.top && R.bottom <= C.bottom;
        cardInfo = { radius: cr, inset: R.left - C.left, fullWidth: R.width >= C.width * 0.8, nearCorner: R.top - C.top < cr || C.bottom - R.bottom < cr,
          crosses: inside && off >= 0 && (ring.left < C.left + 2 || ring.right > C.right - 2 || ring.top < C.top + 2 || ring.bottom > C.bottom - 2) };
      }
      rings.push({ tag: `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 3).join('.')}`, width: wid, offset: off, radius: parseFloat(s.borderTopLeftRadius), card: cardInfo, gap, self: n === el, rect: { left: R.left, top: R.top, right: R.right, bottom: R.bottom } });
    }
  }
  const r = el.getBoundingClientRect();
  return { scale, rimHi: c.getPropertyValue('--glass-rim-hi').trim(), shadow: c.boxShadow, bg: c.backgroundColor, rings, box: { x: r.left, y: r.top, w: r.width, h: r.height } };
}

/** In the page: pixel comparison of two clips; and in dark, whether the top inner rows read as pure white. */
async function compare(a, b, pad) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
  const A = await load(a), B = await load(b);
  const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
  let changed = 0, max = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * A.width + x) * 4, j = (y * B.width + x) * 4;
    const d = Math.max(Math.abs(A.data[i] - B.data[j]), Math.abs(A.data[i + 1] - B.data[j + 1]), Math.abs(A.data[i + 2] - B.data[j + 2]));
    if (d >= 12) changed++; max = Math.max(max, d);
  }
  // Top rim: rows pad..pad+2 (the element's top edge) over the middle 60 % of its width, in B.
  let whiteTop = 0;
  for (let y = pad - 1; y < pad + 3 && y < B.height; y++) {
    let white = 0, n = 0;
    for (let x = Math.round(B.width * 0.2); x < B.width * 0.8; x++) { const i = (y * B.width + x) * 4; n++; if (B.data[i] >= 250 && B.data[i + 1] >= 250 && B.data[i + 2] >= 250) white++; }
    if (n) whiteTop = Math.max(whiteTop, white / n);
  }
  return { changed, max, frac: changed / (w * h), whiteTop };
}

/** In the page: along the ring's middle line, corners included (it follows the host's radius, so a disc or a pill is
 *  sampled on its curve), the share of pixels that differ by 24 levels or more between the focused and the unfocused
 *  clip. */
async function drawn(a, b, ring, clip) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
  const A = await load(a), B = await load(b);
  const d = ring.offset + ring.width / 2, R = ring.rect;
  const r = Math.min(ring.radius, (R.right - R.left) / 2, (R.bottom - R.top) / 2), m = Math.max(0, r + d);
  const L = R.left - d, T = R.top - d, Rt = R.right + d, Bt = R.bottom + d;
  const pts = [];
  for (let x = L + m; x <= Rt - m; x++) pts.push([x, T], [x, Bt]);
  for (let y = T + m; y <= Bt - m; y++) pts.push([L, y], [Rt, y]);
  if (m > 0) for (let t = 0; t < Math.PI / 2; t += 1 / m) {
    const c = Math.cos(t) * m, s = Math.sin(t) * m;
    pts.push([L + m - c, T + m - s], [Rt - m + c, T + m - s], [L + m - c, Bt - m + s], [Rt - m + c, Bt - m + s]);
  }
  let n = 0, hit = 0;
  // A point counts when its pixel or a neighbour changed: the painted ring snaps to whole pixels, up to 1px from the
  // fractional box.
  const diff = (x, y) => { if (x < 0 || y < 0 || x >= A.width || y >= A.height) return false; const i = (y * A.width + x) * 4; return Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])) >= 24; };
  for (const [px, py] of pts) {
    const x = Math.floor(px) - clip.x, y = Math.floor(py) - clip.y;
    if (x < 0 || y < 0 || x >= A.width || y >= A.height) continue;
    n++;
    let any = false;
    for (let dy = -1; dy <= 1 && !any; dy++) for (let dx = -1; dx <= 1 && !any; dx++) any = diff(x + dx, y + dy);
    if (any) hit++;
  }
  return { n, hit, share: n ? hit / n : 0 };
}

/** In the page: a switch at rest and pressed: the largest step between neighbouring pixels along the knob row. */
async function switchPx(a, b, pad) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
  const one = (D) => {
    const h = D.height - 2 * pad, lum = (i) => 0.299 * D.data[i] + 0.587 * D.data[i + 1] + 0.114 * D.data[i + 2];
    let step = 0; const y = Math.round(pad + h / 2);
    for (let x = 1; x < D.width; x++) step = Math.max(step, Math.abs(lum((y * D.width + x) * 4) - lum((y * D.width + x - 1) * 4)));
    return { step };
  };
  return { rest: one(await load(a)), press: one(await load(b)) };
}

const h = await start();
const results = [];
const PAD = 4;
const SINK = 6;
/** Hover moves the face median by at least this many levels, in either direction. */
const HOVER = 6;
const FOC = 'a, button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
/** Classes of elements that legitimately do not follow a face rule. rule: 'face' (no face rule at all), 'hover', 'sink'. */
const EXEMPT = [
  { rule: 'face', why: 'a link in running text has no face; its hover is the colour and underline change (pixel rule)', test: (it) => it.textLink },
  { rule: 'sink', why: 'window caption buttons follow the Windows convention: hover and press are fills over the title bar, close turns red', test: (it) => it.caption },
  { rule: 'face', why: 'the assistant character is a picture that is dragged and right-clicked; its feedback is the cursor and the menu', test: (it) => it.key.includes('sprite-slot') },
  { rule: 'hover', why: 'a theme swatch shows the colours of its theme; a hover tint would misstate them (it lifts and brightens its rim instead)', test: (it) => /(^|\.)theme(\.|:|$)/.test(it.key) },
  { rule: 'hover', why: 'light cards carry pinyin in tone colours at 5:1 on white; a tint that moves the face 6 levels takes it under 4.5:1 (rows at 14 %: 4.4:1), so hover is the 2px lift, the wider shadow, the brighter rim and an 8 % tint', test: (it, mode) => mode === 'light' && /glass-lift/.test(it.key) },
  { rule: 'face', why: 'a colour field shows the chosen colour, and pressing it opens the system picker over it', test: (it) => it.key.startsWith('input[color]') },
  { rule: 'sink', why: 'pressing a slider moves its value to the pointer; the fill and knob under the pointer are the feedback', test: (it) => it.key.startsWith('input[range]') || /(^|\.)range(\.|:|$)/.test(it.key) },
];
async function sampleAll(p, where, theme, mode, only) {
  const items = await p.evaluate(enumerate);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (only && !it.key.includes(only)) continue;
    const got = await p.evaluate((i) => { const el = document.querySelector(`[data-st="${i}"]`); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, i);
    if (!got || got.y < 0 || got.y + got.h > (await p.evaluate(() => innerHeight))) continue;
    const clip = { x: Math.max(0, got.x - PAD), y: Math.max(0, got.y - PAD), width: got.w + 2 * PAD, height: got.h + 2 * PAD };
    const shot = () => p.screenshot({ encoding: 'base64', clip });
    await p.mouse.move(1, 1); await sleep(250);
    const rest = await shot(), sRest = await p.evaluate(snapshot, i);
    // A small control (an icon disc, a headword) leaves too little padding at the full margins: then 2px in, no margin.
    let pts = await p.evaluate(regionOf, i, clip);
    if (pts.length < 12) pts = await p.evaluate(regionOf, i, clip, true);
    await p.mouse.move(got.x + got.w / 2, got.y + got.h / 2); await sleep(330);
    const hover = await shot(), sHover = await p.evaluate(snapshot, i);
    await p.mouse.down(); await sleep(330);
    const press = await shot(), sPress = await p.evaluate(snapshot, i);
    await p.mouse.move(1, 1); await p.mouse.up(); await sleep(150);
    // A disabled control is shot at rest again: a change against both rest shots is its own, not the page moving.
    const rest2 = it.disabled ? (await sleep(250), await shot()) : null;
    await p.evaluate(() => getSelection()?.removeAllRanges());
    // The press may have changed the page (a toggle on mousedown): stop sampling this page if the sample is gone.
    const still = await p.evaluate((i) => !!document.querySelector(`[data-st="${i}"]`), i);
    let sFocus = null, reached = true, ink = null;
    if (still) {
      // Focus by keyboard: put focus on the control, Tab away, Shift+Tab back. Script focus alone can land on a
      // control that already holds pointer focus, which never shows a ring.
      const has = await p.evaluate((i, FOC) => { const el = document.querySelector(`[data-st="${i}"]`); const f = el.matches(FOC) ? el : el.querySelector(FOC); if (!f) return false; f.setAttribute('data-st-focus', ''); f.focus({ preventScroll: true }); return true; }, i, FOC);
      if (has) {
        await p.keyboard.press('Tab'); await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
        await sleep(250);
        reached = await p.evaluate(() => !!document.activeElement?.hasAttribute('data-st-focus'));
        // The last control of a page: Tab leaves the document, so come back the other way (Shift+Tab, then Tab).
        if (!reached) {
          await p.evaluate(() => document.querySelector('[data-st-focus]')?.focus({ preventScroll: true }));
          await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift'); await p.keyboard.press('Tab');
          await sleep(250);
          reached = await p.evaluate(() => !!document.activeElement?.hasAttribute('data-st-focus'));
        }
        sFocus = await p.evaluate(snapshot, i);
        if (reached && sFocus.rings.length === 1) {
          const ring = sFocus.rings[0], R = ring.rect, out = Math.max(0, ring.offset + ring.width) + 2;
          const fclip = { x: Math.max(0, Math.floor(R.left - out)), y: Math.max(0, Math.floor(R.top - out)) };
          fclip.width = Math.ceil(R.right + out) - fclip.x; fclip.height = Math.ceil(R.bottom + out) - fclip.y;
          const on = await p.screenshot({ encoding: 'base64', clip: fclip });
          await p.evaluate(() => document.activeElement?.blur()); await sleep(250);
          const off = await p.screenshot({ encoding: 'base64', clip: fclip });
          ink = await p.evaluate(drawn, on, off, ring, fclip);
        }
        await p.evaluate(() => { document.activeElement?.blur(); document.querySelector('[data-st-focus]')?.removeAttribute('data-st-focus'); });
      }
    }
    const [fRest, fHover, fPress] = (pts.length >= 12 ? await p.evaluate(faceMed, [rest, hover, press], pts) : [null, null, null]).map((v) => v ?? NaN);
    const face = { rest: fRest, hover: fHover, press: fPress, points: pts.length };
    const exempt = (rule) => EXEMPT.find((e) => e.rule === rule && e.test(it, mode));
    const sw = it.switch && !it.disabled ? await p.evaluate(switchPx, rest, press, PAD) : null;
    const hv = await p.evaluate(compare, rest, hover, PAD);
    const pr = await p.evaluate(compare, hover, press, PAD);
    const problems = [];
    const differs = (c) => c.changed >= 25 || c.frac >= 0.01;
    if (it.disabled) {
      const hv2 = await p.evaluate(compare, rest2, hover, PAD), pr2 = await p.evaluate(compare, rest2, press, PAD);
      if (differs(hv) && differs(hv2)) problems.push(`disabled but reacts to hover (${hv.changed} px)`);
      if ((differs(pr) && differs(pr2)) || sPress.scale < 1) problems.push(`disabled but reacts to press (${pr.changed} px, scale ${sPress.scale})`);
    } else {
      if (!differs(hv)) problems.push(`no hover change (${hv.changed} px, max ${hv.max})`);
      const pressCue = sPress.scale < 0.995 || sPress.rimHi !== sHover.rimHi || sPress.shadow !== sHover.shadow || differs(pr);
      if (!pressCue && !it.textLink) problems.push(`no press change (${pr.changed} px, scale ${sPress.scale}, rim ${sPress.rimHi})`);
      if (sw && sw.press.step < 0.75 * sw.rest.step) problems.push(`press blurs the switch: sharpest step ${sw.rest.step.toFixed(0)} at rest, ${sw.press.step.toFixed(0)} pressed`);
      const skipFace = exempt('face');
      if (!skipFace && Number.isNaN(face.rest)) problems.push(`no padding to measure the face in (${pts.length} points)`);
      if (!skipFace && !Number.isNaN(face.rest)) {
        if (!exempt('hover') && Math.abs(face.hover - face.rest) < HOVER) problems.push(`hover too weak: face ${face.rest.toFixed(1)} at rest, ${face.hover.toFixed(1)} hovered (want ${HOVER} levels either way)`);
        if (mode === 'dark' && !exempt('sink') && face.press > face.rest - SINK) problems.push(`press does not sink: face ${face.rest.toFixed(1)} at rest, ${face.press.toFixed(1)} pressed (want ${SINK} darker)`);
      }
      if (mode === 'dark' && hv.whiteTop > 0.6) problems.push(`pure white top rim on hover (${Math.round(hv.whiteTop * 100)}% of the top rows)`);
      if (!reached) problems.push('Tab and Shift+Tab do not return focus to the control');
      if (sFocus && reached) {
        const rings = sFocus.rings;
        if (ink && ink.share < 0.5) problems.push(`focus ring not drawn: ${ink.hit}/${ink.n} pixels on its middle line change`);
        if (rings.length === 0) problems.push('no focus ring');
        else if (rings.length > 1) problems.push(`${rings.length} focus rings: ${rings.map((r) => `${r.tag} ${r.width}px@${r.offset}`).join(', ')}`);
        else {
          const r = rings[0];
          if (r.width !== 2) problems.push(`focus ring ${r.width}px wide`);
          const inset = r.offset < 0;
          if (!inset && r.offset !== 2) problems.push(`focus ring at offset ${r.offset}px (want 2px out)`);
          if (inset && r.card && r.card.fullWidth && r.card.nearCorner) {
            const ringR = Math.max(0, r.radius + r.offset), want = Math.max(0, r.card.radius - (r.card.inset - r.offset));
            if (Math.abs(ringR - want) > 2) problems.push(`inset ring radius ${ringR}px, ${r.card.inset - r.offset}px inside a ${r.card.radius}px card (want ${want}px, concentric)`);
          }
          if (r.card?.crosses) problems.push('focus ring crosses its card edge');
          if (!inset && r.gap < 2) problems.push(`focus ring ${r.gap < 0 ? 'overlaps' : `${r.gap}px from`} another control`);
        }
      }
    }
    results.push({ theme, mode, where, key: it.key, label: it.label, disabled: it.disabled, hover: hv, press: pr, scale: sPress.scale, face, sw, ink, reached, rings: sFocus?.rings, problems, exempt: ['face', 'hover', 'sink'].filter((r) => !it.disabled && exempt(r)).map((r) => `${r}: ${exempt(r).why}`) });
  }
}
try {
  for (const { theme, mode } of COMBOS) {
    const w = await h.open({ hash: '#/', size: { width: 860, height: 600 }, seed: seedFor({ theme, mode }) });
    const p = w.page;
    // The hover-pinyin tip is a separate element that follows the pointer over Chinese text. Its shadow fell in the 4px
    // margin of the sample above a graded Ghep cau tile (the tile itself changed 0 px), so a control that does not react
    // read as reacting; the same tip could make a control that does not react pass.
    await p.addStyleTag({ content: '.tip { display: none !important; }' });
    try {
      for (const [hash, prep] of process.env.PET_ONLY ? [] : PAGES.filter(([x]) => !process.env.PAGES || process.env.PAGES.split(',').includes(x))) {
        await p.evaluate(() => { location.hash = '#/about'; }); await sleep(200);
        await p.evaluate((x) => { location.hash = x; }, hash);
        await p.waitForFunction((x) => decodeURIComponent(location.hash) === x && document.querySelector('.page'), { timeout: 15000 }, hash);
        await h.settle(p, 450);
        if (prep) await PREP[prep](p);
        if (process.env.NORING) await p.addStyleTag({ content: '* { outline-color: transparent !important; }' });
        await sampleAll(p, prep ? `${hash} (${prep})` : hash, theme, mode);
      }
    } finally { await w.close(); }
    // Pet window: the bubble's buttons, then the nap pill.
    const pet = await h.open({ label: 'pet', seed: seedFor({ theme, mode, settings: { guessFirst: false } }) });
    try { await pet.page.waitForSelector('.bubble .vi', { timeout: 20000 }); await h.syncPet(pet.page); await h.settle(pet.page, 400); await sampleAll(pet.page, 'pet bubble', theme, mode); } finally { await pet.close(); }
    // The guess state (meaning hidden on a word seen before): its pill replaces the meaning.
    const guess = await h.open({ label: 'pet', seed: seedFor({ theme, mode, settings: { guessFirst: true } }) });
    try { await guess.page.waitForSelector('.bubble .guess', { timeout: 20000 }); await h.syncPet(guess.page); await h.settle(guess.page, 400); await sampleAll(guess.page, 'pet guess', theme, mode, 'guess'); } finally { await guess.close(); }
    const nap = await h.open({ label: 'pet', seed: seedFor({ theme, mode, settings: { topics: [], hsk: [] }, progress: { exposure: {}, srs: {}, seenDays: {}, reviewDays: {} } }) });
    try { await nap.page.waitForSelector('.nap', { timeout: 20000 }); await h.syncPet(nap.page); await h.settle(nap.page, 400); await sampleAll(nap.page, 'pet nap', theme, mode); } finally { await nap.close(); }
    console.log(theme, mode, results.length);
  }
} finally { await h.close(); }
writeFileSync(OUT, JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.problems.length);
console.log(`\n${results.length} samples, ${bad.length} with problems`);
const ex = new Map();
for (const r of results) for (const e of r.exempt ?? []) ex.set(e, (ex.get(e) ?? 0) + 1);
for (const [e, n] of ex) console.log(`exempt ${n}x | ${e}`);
for (const r of bad) console.log(`${r.theme} ${r.mode} | ${r.where} | ${r.key} "${r.label}" | ${r.problems.join('; ')}`);
