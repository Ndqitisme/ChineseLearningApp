// Measures text and icon contrast on the real pages: every visible text run (and mask icon) is
// located, then a screenshot is taken with all text made transparent, and the run's own rectangle is
// scanned for the pixel that gives the WORST contrast against the text colour (for a mask icon, only the pixels its
// mask covers and their 1px neighbours: the corners of a round icon's box hold nothing it sits on). That pixel is the
// hardest backdrop region behind the glass under that text. WCAG: 4.5 normal text, 3 large text
// (>= 24px, or >= 18.66px at weight >= 700) and icons. Elements at opacity < .9 (disabled) are skipped.
// Every page is measured in steps of 80 % of its scroll box, so nothing between the top and the bottom is missed.
// States: quiz answered, review flipped and graded, build result, tones checked, every selected topic card and lit
// bell (one per group hue), and hover, press and keyboard focus on each tinted control (measured inside it only).
// Rendered ink (kind "ink"): all text below the WCAG large-text size (under 24px, or under 18.66px at weight 600 or more)
// and thin text (weight 300 or less) is also measured on the pixels it paints, since its strokes never reach their declared
// colour: the median of the darkest quartile of its ink pixels against the local face, at 4.5:1. (Up to round 18 only
// 13px or less was: 15px tone pinyin, 14px muted lines and the Kai subtitle passed on their declared colour at 3.2-4.4 ink.)
// Extra states: the pinyin tooltip (one per page, a word with a Han-Viet line when there is one), word rows, HSK lesson
// rows and plain pills (rest, hover, press, focus), an opened HSK lesson, and the bubble's guess pill hovered and pressed.
// An empty field's ::placeholder is a run too (path ends in ::placeholder), in its own colour, and always gets the
// rendered-ink check: a muted regular hint at 15-16px read 3.9:1 on its ink while its declared colour passed.
// Each page (and each bubble window) is measured in a window of its own and stored by a hash of its inputs (deps.mjs):
// a page whose files did not change is read back, not measured again. NOCACHE=1 measures everything.
// Usage: GLASS=refract|fallback|reduced [NOCACHE=1] [ONLY=ocean-dark,...] [PAGES_ONLY=#/a,#/b] [SIZES=1400x900,...] [PET_ONLY=1] [PET_SKIN=leaf|off] node contrast.mjs [out.json]
import { writeFileSync } from 'node:fs';
import { WORK, seedFor, sleep, start } from './harness.mjs';
import { data } from './harness.mjs';
import { cache } from './deps.mjs';

const GLASS = process.env.GLASS ?? 'refract';
const OUT = process.argv[2] ?? `${WORK}/contrast-${GLASS}.json`;
const QUERY = GLASS === 'fallback' ? '?glass=fallback' : '';
const MEDIA = GLASS === 'reduced' ? [{ name: 'prefers-reduced-transparency', value: 'reduce' }] : [];
// PET_SKIN=leaf measures the bubble with that skin (off: the skin switch off); unset, the default character skin.
const PET_SKIN = process.env.PET_SKIN;
const SKIN_SETTINGS = !PET_SKIN ? {} : PET_SKIN === 'off' ? { petSkinOn: false } : { petSkinOn: true, petSkin: PET_SKIN };
const longest = data.words.filter((w) => w.ex && w.topics.length).sort((a, b) => b.vi.length - a.vi.length)[0];
const PAGES = ['#/', '#/topics', '#/topic/greetings', '#/hsk/1', `#/word/${longest.id}`, '#/practice', '#/quiz/meaning', '#/review', '#/write', '#/build/order', '#/tones', '#/search/ni', '#/notebook', '#/settings', '#/about', '#/support'];
const PRACTICE = ['#/quiz/meaning', '#/review', '#/write', '#/build/order', '#/tones'];
// PAGES_ONLY=#/tones re-checks one page (and skips the bubble, unless PET=1); any hash is accepted (#/search shows the
// empty field's placeholder).
if (process.env.PAGES_ONLY) { const keep = process.env.PAGES_ONLY.split(','); PAGES.splice(0, PAGES.length, ...keep); PRACTICE.splice(0, PRACTICE.length, ...PRACTICE.filter((p) => keep.includes(p))); }
// SIZES=860x600,1120x760,1400x900 runs every page at each of those window sizes instead of the default pair.
const SIZES = process.env.SIZES?.split(',').map((s) => { const [width, height] = s.split('x').map(Number); return [{ width, height }, PAGES]; });
const COMBOS = [];
for (const theme of ['sakura', 'matcha', 'boba', 'ocean', 'night']) for (const mode of ['light', 'dark']) COMBOS.push({ theme, mode });
// ONLY=sakura-light,boba-dark limits the run to those combos.
if (process.env.ONLY) COMBOS.splice(0, COMBOS.length, ...COMBOS.filter((c) => process.env.ONLY.split(',').includes(`${c.theme}-${c.mode}`)));

/** Runs in the page: collects text runs and icons with colour, size, weight and viewport rects. */
function collect(onlyMarked = false) {
  const out = [];
  const keep = (el) => !onlyMarked || el.closest('[data-cx-target]');
  const vw = innerWidth, vh = innerHeight;
  // Whole pixels inside the rect only (ceil the near edges, floor the far ones).
  const clip = (r) => { const x = Math.max(0, Math.ceil(r.left)), y = Math.max(0, Math.ceil(r.top)); return { x, y, w: Math.min(vw, Math.floor(r.right)) - x, h: Math.min(vh, Math.floor(r.bottom)) - y }; };
  // Content scrolled out of its scroll box is clipped there, not measured against what covers it (the title bar).
  const scrollClip = (r, el) => {
    let out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).overflowY === 'visible') continue;
      const b = n.getBoundingClientRect();
      out = { left: Math.max(out.left, b.left), top: Math.max(out.top, b.top), right: Math.min(out.right, b.right), bottom: Math.min(out.bottom, b.bottom) };
    }
    return out;
  };
  const faded = (el) => { for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (parseFloat(cs.opacity) < 0.9 || cs.visibility === 'hidden') return true; } return false; };
  const path = (el) => { const parts = []; for (let n = el, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) parts.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : '')); return parts.join(' > '); };
  // Computed colours come back as rgb(…) or color(srgb r g b [/ a]); normalise to 0–255 channels.
  const chan = (s) => { const m = s.match(/[\d.]+(?:e-?\d+)?/g).map(Number); return s.startsWith('color(') ? [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1] : m; };
  // Glyph ink never reaches the line box edge, so a text rect is clipped to its element's box inset by 1px:
  // the 1px sheen line at a control's top edge is not a backdrop any letter sits on.
  const within = (r, el) => { const b = el.getBoundingClientRect(); const x = Math.max(r.left, b.left + 1), y = Math.max(r.top, b.top + 1), x2 = Math.min(r.right, b.right - 1), y2 = Math.min(r.bottom, b.bottom - 1); return { left: x, top: y, right: x2, bottom: y2 }; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim()) continue;
    const el = node.parentElement;
    if (!el || !keep(el) || el.closest('script, style, svg') || faded(el) || !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
    const cs = getComputedStyle(el);
    const col = chan(cs.color);
    if (col[3] === 0) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const r0 of range.getClientRects()) {
      const text = node.data.trim();
      // Single symbols (★ ✓ ← ▢ ✕ ˊ …) are icons, not words; in a round button only the middle half holds ink.
      const symbol = !/\p{L}|\p{N}/u.test(text);
      let r = scrollClip(within(r0, el), el);
      if (symbol) { const dx = (r.right - r.left) / 4, dy = (r.bottom - r.top) / 4; r = { left: r.left + dx, top: r.top + dy, right: r.right - dx, bottom: r.bottom - dy }; }
      const c = clip(r);
      if (c.w < 2 || c.h < 2) continue;
      const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const kind = symbol ? 'icon' : large ? 'large' : 'text';
      // A line cut by the scroll box or window edge shows only antialiased stroke ends (8 of 16 px: 1.8:1 on a tone colour
      // that reads 4.3 whole); the 80 % scroll step shows it whole in the next view, so only its rendered ink is skipped.
      const cut = c.h < 0.75 * (r0.bottom - r0.top - 2);
      out.push({ kind, need: kind === 'text' ? 4.5 : 3, color: col, size, weight, text: text.slice(0, 28), path: path(el), rect: c, cut });
    }
  }
  // Placeholders are not text nodes: an empty field's placeholder is a run of its own, in the ::placeholder colour,
  // over the field's content box, as wide as its longest line.
  for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (el.value || !el.placeholder.trim() || !keep(el) || faded(el) || !el.checkVisibility({ visibilityProperty: true })) continue;
    const cs = getComputedStyle(el), ps = getComputedStyle(el, '::placeholder');
    const col = chan(ps.color);
    if (col[3] === 0) continue;
    const g = document.createElement('canvas').getContext('2d'); g.font = `${ps.fontStyle} ${ps.fontWeight} ${ps.fontSize} ${ps.fontFamily}`;
    const lines = el.placeholder.split(/\r?\n/);
    const b = el.getBoundingClientRect(), pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), pt = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    const lh = parseFloat(cs.lineHeight) || parseFloat(ps.fontSize) * 1.25, size = parseFloat(ps.fontSize), weight = parseInt(ps.fontWeight);
    const textW = Math.max(...lines.map((l) => g.measureText(l).width));
    // A single-line field centres its line in the content box.
    const top = el.tagName === 'INPUT' ? b.top + b.height / 2 - lh / 2 : b.top + pt;
    const r = scrollClip(within({ left: b.left + pl, top, right: Math.min(b.right - parseFloat(cs.paddingRight), b.left + pl + textW), bottom: Math.min(b.bottom - parseFloat(cs.paddingBottom), top + lh * lines.length) }, el), el);
    const c = clip(r);
    if (c.w < 2 || c.h < 2) continue;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({ kind: large ? 'large' : 'text', need: large ? 3 : 4.5, color: col, size, weight, text: el.placeholder.slice(0, 28), path: path(el) + '::placeholder', rect: c, placeholder: true });
  }
  for (const el of document.querySelectorAll('.icon')) {
    if (!keep(el) || faded(el)) continue;
    const cs = getComputedStyle(el);
    const c = clip(scrollClip(el.getBoundingClientRect(), el));
    if (c.w < 2 || c.h < 2) continue;
    const full = el.getBoundingClientRect();
    out.push({ kind: 'icon', need: 3, color: chan(cs.color), size: c.w, weight: 0, text: el.style.getPropertyValue('--src').replace(/url\(\/icons\/|\.png\)/g, ''), path: path(el), rect: c, full: { x: full.left, y: full.top, w: full.width, h: full.height } });
  }
  return out;
}

/** Runs in the page: for each item, the worst-contrast pixel inside its rect on the text-less screenshot.
 *  [ox, oy] is where the shot's top left corner sits in the window (a shot of one control starts at the control). */
async function worst(b64, items, [ox, oy] = [0, 0]) {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Icon masks, drawn at each icon's own box size.
  const masks = new Map();
  for (const it of items) {
    if (it.kind !== 'icon' || !it.full) continue;
    const im = new Image(); im.src = `/icons/${it.text}.png`;
    try { await im.decode(); } catch { continue; }
    const w = Math.max(1, Math.round(it.full.w)), h = Math.max(1, Math.round(it.full.h));
    const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
    const mg = mc.getContext('2d', { willReadFrequently: true }); const k = Math.min(w / im.width, h / im.height);
    mg.drawImage(im, (w - im.width * k) / 2, (h - im.height * k) / 2, im.width * k, im.height * k);
    masks.set(it, { a: mg.getImageData(0, 0, w, h).data, w, h, ox: Math.round(it.rect.x - it.full.x), oy: Math.round(it.rect.y - it.full.y) });
  }
  const inked = (mk, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const mx = x + mk.ox + dx, my = y + mk.oy + dy; if (mx >= 0 && my >= 0 && mx < mk.w && my < mk.h && mk.a[(my * mk.w + mx) * 4 + 3] > 32) return true; } return false; };
  return items.map((it) => {
    const mk = masks.get(it);
    const m = it.color;
    const a = m[3] ?? 1;
    const fgL = lum(m[0], m[1], m[2]);
    // The backdrop is the 3×3 region around each pixel (one pixel of margin outside the rect): a hairline of the
    // hatch is not a region a glyph sits on, a dark shape is.
    const X = it.rect.x - ox, Y = it.rect.y - oy;
    const rx = Math.max(0, X - 1), ry = Math.max(0, Y - 1);
    const rw = Math.min(cv.width - rx, it.rect.w + 2), rh = Math.min(cv.height - ry, it.rect.h + 2);
    const px = ctx.getImageData(rx, ry, rw, rh).data;
    let minRatio = Infinity, at = null;
    for (let y = 1; y < rh - 1; y++) for (let x = 1; x < rw - 1; x++) {
      if (mk && !inked(mk, Math.round(x + rx - X), Math.round(y + ry - Y))) continue;
      let r0 = 0, g0 = 0, b0 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = ((y + dy) * rw + (x + dx)) * 4; r0 += px[o]; g0 += px[o + 1]; b0 += px[o + 2]; }
      r0 /= 9; g0 /= 9; b0 /= 9;
      // text at alpha a over this region
      const r = m[0] * a + r0 * (1 - a), g = m[1] * a + g0 * (1 - a), b = m[2] * a + b0 * (1 - a);
      const fl = a === 1 ? fgL : lum(r, g, b);
      const bl = lum(r0, g0, b0);
      const ratio = (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05);
      if (ratio < minRatio) { minRatio = ratio; at = [Math.round(r0), Math.round(g0), Math.round(b0)]; }
    }
    return { ...it, ratio: +minRatio.toFixed(2), bg: at };
  });
}


/** Small (13px or less) or thin (weight 300 or less) text renders lighter than its declared colour: antialiasing never
 *  lets a stroke one pixel wide reach it. Runs in the page: per such run, the ink pixels (where the screenshot with text
 *  differs from the one without, by at least a fifth of the way from the face to the declared colour), ranked by
 *  contrast against the local face (the 3x3 average of the text-less shot at the same place); the result is the median
 *  of the darkest quartile, the typical stroke core. */
async function rendered(withB64, withoutB64, items, [ox, oy] = [0, 0]) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g; };
  const A = await load(withB64), B = await load(withoutB64);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const q = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  return items.map((it) => {
    const rx = Math.max(0, it.rect.x - ox - 1), ry = Math.max(0, it.rect.y - oy - 1);
    const rw = Math.min(A.canvas.width - rx, it.rect.w + 2), rh = Math.min(A.canvas.height - ry, it.rect.h + 2);
    const a = A.getImageData(rx, ry, rw, rh).data, b = B.getImageData(rx, ry, rw, rh).data;
    const tl = lum(it.color[0], it.color[1], it.color[2]);
    const ink = [];
    for (let y = 1; y < rh - 1; y++) for (let x = 1; x < rw - 1; x++) {
      let r0 = 0, g0 = 0, b0 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = ((y + dy) * rw + (x + dx)) * 4; r0 += b[o]; g0 += b[o + 1]; b0 += b[o + 2]; }
      const fl = lum(r0 / 9, g0 / 9, b0 / 9), o = (y * rw + x) * 4, pl = lum(a[o], a[o + 1], a[o + 2]);
      if (Math.abs(fl - tl) < 1e-3) continue;
      const cover = (fl - pl) / (fl - tl);
      if (cover >= 0.2) ink.push({ ratio: q(pl, fl), px: [a[o], a[o + 1], a[o + 2]], bg: [Math.round(r0 / 9), Math.round(g0 / 9), Math.round(b0 / 9)] });
    }
    if (ink.length < 4) return null;
    ink.sort((u, v) => v.ratio - u.ratio);
    const quart = ink.slice(0, Math.max(1, Math.round(ink.length / 4)));
    const m = quart[quart.length >> 1];
    return { ...it, kind: 'ink', need: 4.5, ratio: +m.ratio.toFixed(2), peak: +ink[0].ratio.toFixed(2), inkPx: m.px, bg: m.bg, inked: ink.length };
  }).filter(Boolean);
}

const HIDE = '* { transition: none !important; caret-color: transparent !important; color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } ::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; } .icon { visibility: hidden !important; } .stroke svg { visibility: hidden !important; } img, canvas { visibility: hidden !important; }';

// No caret: a focused empty field (the search page focuses its input) blinks between the two shots of the ink pair.
const STILL = '* { transition: none !important; caret-color: transparent !important; } .icon { visibility: hidden !important; } .stroke svg { visibility: hidden !important; } img, canvas { visibility: hidden !important; }';

/** Below the large-text size for the rendered-ink check: under 24px, or under 18.66px at weight 600 or more. */
const inkSized = (it) => it.size < 24 && !(it.size >= 18.66 && it.weight >= 600);

const h = await start();
const results = [];
const settle = (page, ms = 150) => sleep(ms);
/** One measurement of the current view (or only inside the marked element). */
async function measure(page, onlyMarked, push) {
  const items = await page.evaluate(collect, onlyMarked);
  if (!items.length) return;
  const small = items.filter((it) => it.kind === 'text' && !it.cut && (inkSized(it) || it.weight <= 300 || it.placeholder));
  // Inside a marked control only the region its items cover (and the 1px around it that the backdrop average reads) is shot.
  let clip = null;
  if (onlyMarked) {
    const vp = page.viewport();
    const x = Math.max(0, Math.min(...items.map((it) => it.rect.x)) - 1), y = Math.max(0, Math.min(...items.map((it) => it.rect.y)) - 1);
    const x2 = Math.min(vp.width, Math.max(...items.map((it) => it.rect.x + it.rect.w)) + 1), y2 = Math.min(vp.height, Math.max(...items.map((it) => it.rect.y + it.rect.h)) + 1);
    clip = { x, y, width: x2 - x, height: y2 - y };
  }
  const off = clip ? [clip.x, clip.y] : [0, 0];
  const shot = () => page.screenshot({ encoding: 'base64', ...(clip ? { clip, captureBeyondViewport: false } : {}) });
  const withText = async () => { const still = await page.addStyleTag({ content: STILL }); await sleep(60); const s = await shot(); await still.evaluate((n) => n.remove()); return s; };
  const without = async () => { const style = await page.addStyleTag({ content: HIDE }); await sleep(60); const s = await shot(); await style.evaluate((n) => n.remove()); await sleep(250); return s; };
  if (!small.length) { const b64 = await without(); for (const m of await page.evaluate(worst, b64, items, off)) push(m); return; }
  // The rendered-ink pair must show the same text: a shot with text on both sides of the text-less one, and a retry when
  // the two differ inside the runs (the bubble fading in its first word read as ink at 2.3:1).
  let a, b64, steady = false;
  for (let k = 0; k < 3 && !steady; k++) { a = await withText(); b64 = await without(); steady = await page.evaluate(same, a, await withText(), small, off); }
  for (const m of await page.evaluate(worst, b64, items, off)) push(m);
  for (const m of await page.evaluate(rendered, a, b64, small, off)) push(steady ? m : { ...m, unsteady: true, ratio: 0 });
}
/** In the page: whether two shots match (8 levels) inside every run's rect. */
async function same(x, y, items, [ox, oy] = [0, 0]) {
  const load = async (s) => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g; };
  const A = await load(x), B = await load(y);
  for (const it of items) {
    const a = A.getImageData(it.rect.x - ox, it.rect.y - oy, it.rect.w, it.rect.h).data, b = B.getImageData(it.rect.x - ox, it.rect.y - oy, it.rect.w, it.rect.h).data;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) return false;
  }
  return true;
}
async function mark(page, sel, i = 0) {
  return page.evaluate((sel, i) => {
    document.querySelectorAll('[data-cx-target]').forEach((n) => n.removeAttribute('data-cx-target'));
    const el = document.querySelectorAll(sel)[i]; if (!el) return null;
    el.setAttribute('data-cx-target', ''); el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, i);
}
/** Rest, hover, press and keyboard focus on one control, each measured inside the control. */
async function controlStates(page, sel, i, push, { rest = true, press = true, focus = true } = {}) {
  const c = await mark(page, sel, i); if (!c) return;
  await settle(page, 200);
  const tag = (state) => (m) => push({ ...m, state: `${state} ${sel}` });
  if (rest) { await page.mouse.move(1, 1); await settle(page, 200); await measure(page, true, tag('rest')); }
  await page.mouse.move(c.x, c.y); await settle(page, 300); await measure(page, true, tag('hover'));
  // Moving away with the button down drags a text selection across the page (word rows): cleared before the next shot.
  if (press) { await page.mouse.down(); await settle(page, 250); await measure(page, true, tag('press')); await page.mouse.move(1, 1); await page.mouse.up(); await page.evaluate(() => getSelection()?.removeAllRanges()); await settle(page, 200); }
  if (focus) {
    await page.mouse.move(1, 1); await page.keyboard.press('Shift');
    await page.evaluate(() => { const el = document.querySelector('[data-cx-target]'); const f = el.matches('a, button, input, [tabindex]') ? el : el.querySelector('a, button, input, [tabindex]'); f?.focus(); });
    await settle(page, 250); await measure(page, true, tag('focus'));
    await page.evaluate(() => document.activeElement?.blur());
  }
  await page.evaluate(() => document.querySelectorAll('[data-cx-target]').forEach((n) => n.removeAttribute('data-cx-target')));
}
async function scrollSweep(page, push) {
  const steps = await page.evaluate(() => { const c = document.querySelector('main.content'); return Math.max(1, Math.ceil((c.scrollHeight - c.clientHeight) / (c.clientHeight * 0.8)) + 1); });
  for (let k = 0; k < steps; k++) {
    await page.evaluate((k) => { const c = document.querySelector('main.content'); c.scrollTop = k * c.clientHeight * 0.8; }, k);
    await settle(page);
    await measure(page, false, (m) => push({ ...m, state: `scroll ${k}` }));
  }
}
const all = (page, sel) => page.$$eval(sel, (ns) => ns.length);
/** Tinted controls whose hover, press and focus are measured on every page they appear on. */
// The hover-tinted pills too: the back pill, hued chips, plain chips and the select take a tint on hover.
const TINTED = ['.btn.primary:not(:disabled)', '.chip.on', '.grades .btn', '.side a.active', '.theme.on', '.tone.on', '.back-btn', '.chip.hued', '.chip:not(.on):not(.hued):not(:disabled)', '.select-trigger',
  '.btn:not(.primary):not(:disabled)', 'a.row.glass-row', 'details summary.glass-row'];
/** The pinyin tooltip: hovers Han characters outside pinyin areas until one shows a tip with a Han-Viet line (or, after
 *  12 tries, any tip), then measures inside the tip. */
async function tipState(page, push) {
  const n = await page.evaluate(() => {
    document.querySelectorAll('[data-cx-tip]').forEach((e) => e.removeAttribute('data-cx-tip'));
    const seen = new Set();
    const walker = document.createTreeWalker(document.querySelector('main.content') ?? document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t && seen.size < 12; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!el || seen.has(el) || !/\p{Script=Han}/u.test(t.data) || el.closest('[data-has-pinyin], [data-hover-pinyin="off"]') || !el.checkVisibility({ visibilityProperty: true })) continue;
      el.setAttribute('data-cx-tip', String(seen.size)); seen.add(el);
    }
    return seen.size;
  });
  let best = -1;
  for (let i = 0; i < n; i++) {
    const at = await page.evaluate((i) => {
      const el = document.querySelector(`[data-cx-tip="${i}"]`); el.scrollIntoView({ block: 'center' });
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const k = [...t.data].findIndex((c) => /\p{Script=Han}/u.test(c)); if (k < 0) continue;
        const off = [...t.data].slice(0, k).join('').length;
        const r = document.createRange(); r.setStart(t, off); r.setEnd(t, off + 1); const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    }, i);
    if (!at) continue;
    await page.mouse.move(1, 1); await settle(page, 120);
    await page.mouse.move(at.x, at.y); await settle(page, 300);
    const has = await page.evaluate(() => document.querySelector('.tip') ? (document.querySelector('.tip .hv') ? 2 : 1) : 0);
    if (has === 2 || (has && i === n - 1)) { best = i; break; }
    if (has && best < 0) best = -2 - i;
  }
  if (best < -1) {
    const i = -2 - best;
    const at = await page.evaluate((i) => { const el = document.querySelector(`[data-cx-tip="${i}"]`); el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + 4, y: b.top + b.height / 2 }; }, i);
    await page.mouse.move(1, 1); await settle(page, 120); await page.mouse.move(at.x, at.y); await settle(page, 300);
  }
  const ok = await page.evaluate(() => { const t = document.querySelector('.tip'); t?.setAttribute('data-cx-target', ''); return !!t; });
  if (ok) await measure(page, true, (m) => push({ ...m, state: 'tooltip' }));
  await page.evaluate(() => document.querySelectorAll('[data-cx-target], [data-cx-tip]').forEach((n) => { n.removeAttribute('data-cx-target'); n.removeAttribute('data-cx-tip'); }));
  await page.mouse.move(1, 1); await settle(page, 150);
}
async function go(page, hash) {
  await page.evaluate((x) => { location.hash = x; }, hash);
  await page.waitForFunction((x) => decodeURIComponent(location.hash) === x && document.querySelector('.page'), { timeout: 15_000 }, hash);
  await h.settle(page, 400);
}
const store = cache('contrast.mjs', await h.browser.version());
let reused = 0;
/** Rows of one unit: read back when its inputs are unchanged, else measured by `run(push)` and stored. A unit with an
 *  unsteady ink pair, or one that measured nothing, is not stored, so the next run measures it again. */
async function unit(name, key, run) {
  let rows = store.get(name, key);
  if (rows) reused++;
  else { rows = []; await run((m) => rows.push(m)); if (rows.length && !rows.some((r) => r.unsteady)) store.put(name, key, rows); }
  results.push(...rows);
}
try {
  for (const { theme, mode } of COMBOS) {
    // The wide window for every page, then 860×600 for the practice pages, whose tone buttons shrink to 18 px there.
    for (const [size, pages] of process.env.PET_ONLY ? [] : SIZES ?? [[{ width: 1120, height: 760 }, PAGES], [{ width: 860, height: 600 }, PRACTICE]]) {
      for (const hash of pages) await unit(hash, { theme, mode, glass: GLASS, size }, async (add) => {
        // A window of its own per page: what one page does to the progress store must not reach the next.
        const w = await h.open({ hash: '#/', query: QUERY, media: MEDIA, size, seed: seedFor({ theme, mode }) });
        const p = w.page;
        const push = (m) => add({ theme, mode, glass: GLASS, vw: size.width, page: hash, ...m });
        try {
          await go(p, hash);
          await scrollSweep(p, push);
          for (const sel of TINTED) if (await all(p, sel)) await controlStates(p, sel, 0, push);
          await tipState(p, push);
          if (hash.startsWith('#/hsk/')) {
            await p.evaluate(() => { const d = document.querySelector('details.lesson'); if (d) d.open = true; });
            await settle(p, 300);
            await scrollSweep(p, (m) => push({ ...m, state: 'lesson open ' + m.state }));
          }
          if (hash === '#/topics') {
            // Every selected card (one per group hue and the HSK card) and its lit bell.
            const n = await all(p, '.topic.on');
            for (let i = 0; i < n; i++) {
              await controlStates(p, '.topic.on', i, push, { press: false });
              await controlStates(p, '.topic.on .bell', i, push, { rest: false });
            }
          }
          if (hash === '#/quiz/meaning') {
            await controlStates(p, '.option', 1, push);
            await p.click('.option'); await settle(p, 400);
            await scrollSweep(p, (m) => push({ ...m, state: 'answered ' + m.state }));
          }
          if (hash === '#/review') {
            await controlStates(p, '.flash', 0, push, { press: false });
            await p.click('.flash'); await settle(p, 400);
            await scrollSweep(p, (m) => push({ ...m, state: 'flipped ' + m.state }));
            const g = await all(p, '.grades .btn');
            for (let i = 0; i < g; i++) await controlStates(p, '.grades .btn', i, push, { rest: false });
            await p.click('.grades .btn'); await settle(p, 400);
            await scrollSweep(p, (m) => push({ ...m, state: 'graded ' + m.state }));
          }
          if (hash === '#/build/order') {
            await controlStates(p, '.pool .tile', 0, push);
            for (const t of await p.$$('.pool .tile:not(.used)')) await t.click();
            await settle(p, 200);
            await p.click('.actions .btn.primary'); await settle(p, 400);
            await scrollSweep(p, (m) => push({ ...m, state: 'result ' + m.state }));
          }
          if (hash === '#/tones') {
            await controlStates(p, '.syl .tone', 1, push);
            // The first button of each syllable: usually one right and one wrong, so both states show.
            for (const s of await p.$$('.syl')) await (await s.$('.tone')).click();
            await settle(p, 200);
            await p.click('.drill .btn.primary'); await settle(p, 400);
            await scrollSweep(p, (m) => push({ ...m, state: 'checked ' + m.state }));
          }
        } finally { await w.close(); }
      });
    }
    // Assistant bubble: on a pure white and a pure black desktop (the 10% that shows through), in the guess state (a seen
    // word, meaning hidden) and revealed. The guess state comes first: the first bubble window of a browser is where the
    // bubble once rendered soft (its label at 3.4:1).
    for (const desk of process.env.PAGES_ONLY && !process.env.PET ? [] : ['#ffffff', '#000000']) for (const guess of [true, false]) await unit('pet', { theme, mode, glass: GLASS, desk, guess, ...(PET_SKIN ? { skin: PET_SKIN } : {}) }, async (add) => {
      const w = await h.open({ label: 'pet', media: MEDIA, seed: seedFor({ theme, mode, settings: { guessFirst: guess, ...SKIN_SETTINGS } }) });
      try {
        await w.page.waitForSelector(guess ? '.bubble .guess' : '.bubble .vi', { timeout: 20_000 });
        await h.syncPet(w.page); await h.settle(w.page, 300);
        // Wait until the weights the bubble uses are loaded. (A bubble that read lighter in the first window of a run was
        // the pop animation's raster scale, not the font: see UI-GLASS.md §5, the pop easing.)
        const fonts = await w.page.evaluate(async () => { for (let k = 0; k < 30; k++) { if (['400 15px Nunito', '500 12.5px Nunito', '700 11px Nunito'].every((f) => document.fonts.check(f))) return 'loaded'; await new Promise((r) => setTimeout(r, 100)); } return 'not loaded'; });
        if (fonts !== 'loaded') console.log('pet fonts', fonts, theme, mode, desk);
        await h.settle(w.page, 300);
        await w.page.evaluate((bg) => document.body.style.setProperty('background', bg, 'important'), desk);
        await sleep(100);
        if (guess && !(await w.page.$('.bubble .guess'))) { console.log('pet guess state revealed itself before the measurement', theme, mode, desk); return; }
        // The bubble reveals the meaning by itself 2.6 s after a guess word shows: stop its timers so the pill's hover and
        // press are measured on the guess state, not on a bubble that changed under them.
        if (guess) await w.page.evaluate(() => { const top = setTimeout(() => {}, 0); for (let i = 0; i <= top; i++) clearTimeout(i); });
        await measure(w.page, false, (m) => add({ theme, mode, glass: GLASS, page: `pet${PET_SKIN ? ` ${PET_SKIN}` : ''} on ${desk}`, state: guess ? 'guess' : '', ...m }));
        if (guess) await controlStates(w.page, '.bubble .guess', 0, (m) => add({ theme, mode, glass: GLASS, page: `pet on ${desk}`, ...m }), { rest: false, focus: false });
      } finally { await w.close(); }
    });
    console.log(GLASS, theme, mode, results.length);
  }
} finally { await h.close(); }

writeFileSync(OUT, JSON.stringify(results, null, 1));
const fails = results.filter((r) => r.ratio < r.need);
console.log(`${reused} pages and bubble windows read from the cache`);
console.log(`\n${results.length} runs measured, ${fails.length} below threshold`);
const key = (r) => `${r.theme} ${r.mode} ${r.glass} ${r.vw ?? ''}px ${r.size}px | ${r.page} | ${(r.state ?? '').replace(/ \d+$/, '')} | ${r.path} | "${r.text}" ${r.kind} ${r.color}`;
const seen = new Map();
for (const f of fails) { const k = key(f); if (!seen.has(k) || seen.get(k).ratio > f.ratio) seen.set(k, f); }
for (const f of [...seen.values()].sort((a, b) => a.ratio - b.ratio)) console.log(`${f.ratio.toFixed(2)} (need ${f.need}) bg rgb(${f.bg})${f.kind === 'ink' ? ` ink rgb(${f.inkPx}) peak ${f.peak}` : ''} ${key(f)}`);
