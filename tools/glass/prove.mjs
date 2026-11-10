// Numbers for the review's sign-offs, all measured on the rendered app at 1x:
//  R-2  refract vs ?glass=fallback: pixel diff inside a 12px bezel band of each interactive glass element
//  R-1  light direction: luminance at the four edge midpoints (1px inside) of glass panes; top must beat bottom
//  R-6  hover vs default: pixel diff over the element box (+4px)
//  R-23 press vs default: the same for pressed controls
// node prove.mjs [theme] [mode]  → prints a table and writes proof-<theme>-<mode>.json
import { writeFileSync } from 'node:fs';
import { WORK, seedFor, sleep, start } from './harness.mjs';

const theme = process.argv[2] ?? 'ocean', mode = process.argv[3] ?? 'light';
const SIZE = { width: 860, height: 600 };
const h = await start();
const out = { theme, mode, refract: [], light: [], hover: [], press: [] };

/** Runs in the page: compares two base64 screenshots inside rects; band > 0 keeps only a border band of that width. */
async function diffRects(a, b, rects, band) {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const cv = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); return x; };
  const xa = cv(ia), xb = cv(ib);
  return rects.map(({ name, x, y, w, h }) => {
    const pa = xa.getImageData(x, y, w, h).data, pb = xb.getImageData(x, y, w, h).data;
    let max = 0, sum = 0, n = 0, over8 = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (band && i >= band && i < w - band && j >= band && j < h - band) continue;
      const o = (j * w + i) * 4;
      const d = Math.max(Math.abs(pa[o] - pb[o]), Math.abs(pa[o + 1] - pb[o + 1]), Math.abs(pa[o + 2] - pb[o + 2]));
      max = Math.max(max, d); sum += d; n++; if (d > 8) over8++;
    }
    return { name, px: n, max, mean: +(sum / n).toFixed(2), pctOver8: +((100 * over8) / n).toFixed(1) };
  });
}
/** Runs in the page: luminance at the four edge midpoints of each rect, 1px inside. */
async function edges(b64, rects) {
  const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const L = (px, py) => { const d = x.getImageData(px, py, 1, 1).data; const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return +(0.2126 * lin(d[0]) + 0.7152 * lin(d[1]) + 0.0722 * lin(d[2])).toFixed(4); };
  return rects.map(({ name, x: rx, y: ry, w, h }) => {
    // The rim is the outermost pixel row/column of the element.
    const top = L(rx + Math.round(w / 2), ry), bottom = L(rx + Math.round(w / 2), ry + h - 1), left = L(rx, ry + Math.round(h / 2)), right = L(rx + w - 1, ry + Math.round(h / 2));
    return { name, rect: `${rx},${ry} ${w}x${h}`, top, bottom, left, right, topBrighter: top > bottom, leftBrighter: left > right };
  });
}
const rectsOf = (page, sels) => page.evaluate((sels) => sels.map(([name, sel]) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { name, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(Boolean), sels);
const grow = (r, m) => ({ ...r, x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

try {
  // R-2 and R-1: three pages, refract then fallback, same seed and size.
  for (const [hash, sels, scroll] of [
    ['#/topic/greetings', [['sidebar', 'nav.side'], ['pill primary', '.actions .btn.primary'], ['pill', '.actions .btn:nth-of-type(2)'], ['search field', '.actions input'], ['back pill', '.back-btn'], ['list card', '.card.list']], 0],
    ['#/search', [['search page field', 'input.search']], 0],
    ['#/topics', [['selected card', '.topic.on'], ['plain card', '.topic:not(.on)'], ['bell on', '.bell.on']], 0],
    ['#/settings', [['chip on', '.chip.on'], ['chip', '.chip:not(.on)'], ['swatch on', '.theme.on'], ['swatch', '.theme:not(.on)']], 0],
    ['#/settings', [['switch on', '.content .switch'], ['switch off', '.content .row:has(input[type=time]) .switch'], ['slider', '.range'], ['select', '.select-trigger'], ['time input', 'input[type=time]']], 420],
    ['#/review', [['flash card', '.flash']], 0],
  ]) {
    const shots = {};
    let rects;
    for (const query of ['', '?glass=fallback']) {
      const w = await h.open({ hash, query, size: SIZE, seed: seedFor({ theme, mode }) });
      await w.page.evaluate((v) => { const c = document.querySelector('main.content'); if (c) c.scrollTop = v; }, scroll);
      await h.settle(w.page, 500);
      await w.page.mouse.move(2, 2);
      rects ??= await rectsOf(w.page, sels);
      shots[query || 'refract'] = await w.page.screenshot({ encoding: 'base64' });
      await w.close();
    }
    const w = await h.open({ hash: '#/', size: SIZE, seed: seedFor({ theme, mode }) });
    const d = await w.page.evaluate(diffRects, shots.refract, shots['?glass=fallback'], rects, 12);
    out.refract.push(...d.map((r) => ({ page: hash, ...r })));
    const e = await w.page.evaluate(edges, shots.refract, rects);
    out.light.push(...e.map((r) => ({ page: hash, ...r })));
    await w.close();
  }

  // Round 2 R-2: the rim at 10 %, 50 % and 90 % of each edge of a wide pane (quiz question card, 1400×900).
  {
    const w = await h.open({ hash: '#/quiz/meaning', size: { width: 1400, height: 900 }, seed: seedFor({ theme, mode }) });
    await h.settle(w.page, 500);
    const [q] = await rectsOf(w.page, [['question card', '.question']]);
    const b64 = await w.page.screenshot({ encoding: 'base64' });
    const samples = await w.page.evaluate(async (b64, r) => {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
      const L = (px, py) => { const d = x.getImageData(px, py, 1, 1).data; const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return +(0.2126 * lin(d[0]) + 0.7152 * lin(d[1]) + 0.0722 * lin(d[2])).toFixed(4); };
      const out = {};
      for (const f of [0.1, 0.5, 0.9]) {
        out[`top ${f * 100}%`] = L(r.x + Math.round(r.w * f), r.y);
        out[`bottom ${f * 100}%`] = L(r.x + Math.round(r.w * f), r.y + r.h - 1);
        out[`left ${f * 100}%`] = L(r.x, r.y + Math.round(r.h * f));
        out[`right ${f * 100}%`] = L(r.x + r.w - 1, r.y + Math.round(r.h * f));
      }
      return out;
    }, b64, q);
    out.wideRim = { rect: q, samples };
    await w.close();
  }

  // Round-2 R-11: the real displacement maps. Along a line into the glass (left cap at mid-height, top edge at
  // mid-width, the top-left corner diagonal) the sampled position is p + k·scale·(channel/255 − 0.5); it must grow
  // with p (min step > 0), at k = 1 and at the hover k = 1.2. A step ≤ 0 is a fold (loops in the hatch).
  {
    const w = await h.open({ hash: '#/topic/greetings', size: SIZE, seed: seedFor({ theme, mode }) });
    await h.settle(w.page, 600);
    out.fold = await w.page.evaluate(async (sels) => {
      const res = [];
      for (const [name, sel] of sels) {
        const el = document.querySelector(sel); if (!el) continue;
        const id = getComputedStyle(el).getPropertyValue('--glass-filter').match(/#([\w-]+)/)?.[1]; if (!id) { res.push({ name, error: 'no filter' }); continue; }
        const f = document.getElementById(id);
        const img = f.querySelector('feImage[result=map]'), dm = f.querySelector('feDisplacementMap');
        const scale = +dm.getAttribute('scale');
        const im = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = img.getAttribute('href'); });
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
        const d = x.getImageData(0, 0, im.width, im.height).data;
        const at = (px, py) => { const o = (py * im.width + px) * 4; return [d[o] / 255 - 0.5, d[o + 1] / 255 - 0.5]; };
        const W = im.width, H = im.height, n = Math.floor(Math.min(W, H) / 2);
        const lines = {
          'left cap, mid-height': (i) => [i, Math.floor(H / 2), 1, 0],
          'top edge, mid-width': (i) => [Math.floor(W / 2), i, 0, 1],
          'top-left diagonal': (i) => [i, i, Math.SQRT1_2, Math.SQRT1_2],
        };
        const row = { name, size: `${W}x${H}`, scale: +scale.toFixed(2) };
        for (const [ln, fn] of Object.entries(lines)) for (const k of [1, 1.2]) {
          let min = Infinity, prev;
          for (let i = 0; i < n; i++) {
            const [px, py, ux, uy] = fn(i); const [vx, vy] = at(px, py);
            const pos = i * (ux || uy ? Math.hypot(ux, uy) / Math.max(ux, uy) : 1) + k * scale * (vx * ux + vy * uy);
            if (prev !== undefined) min = Math.min(min, pos - prev);
            prev = pos;
          }
          row[`${ln} k${k}`] = +min.toFixed(3);
        }
        res.push(row);
      }
      return res;
    }, [['pill', '.actions .btn:nth-of-type(2)'], ['search field', '.actions input'], ['back pill', '.back-btn'], ['sidebar', 'nav.side']]);
    await w.close();
  }

  // R-6 / R-23: default, hover and press of the same element in one context.
  const w = await h.open({ hash: '#/', size: SIZE, seed: seedFor({ theme, mode }) });
  const goto = async (hash) => { await w.page.evaluate((x) => { location.hash = x; }, hash); await w.page.waitForFunction((x) => decodeURIComponent(location.hash) === x && document.querySelector('.page'), { timeout: 15000 }, hash); await h.settle(w.page, 450); };
  const pair = async (name, sel, act, prep) => {
    await w.page.mouse.move(2, 2); await sleep(250);
    if (prep) await prep();
    await w.page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await sleep(250);
    const [r] = await rectsOf(w.page, [[name, sel]]);
    const before = await w.page.screenshot({ encoding: 'base64' });
    const b = await w.page.$(sel); const bb = await b.boundingBox();
    await w.page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(300);
    if (act === 'press') { await w.page.mouse.down(); await sleep(250); }
    const after = await w.page.screenshot({ encoding: 'base64' });
    if (act === 'press') { await w.page.mouse.move(2, 2); await w.page.mouse.up(); }
    const [d] = await w.page.evaluate(diffRects, before, after, [grow(r, 4)], 0);
    out[act].push({ name, ...d });
  };
  await goto('#/'); await pair('quick-start card', '.action', 'hover');
  await goto('#/quiz/meaning'); await pair('quiz option', '.option:nth-of-type(2)', 'hover');
  await goto('#/topics'); await pair('topic card', '.topic:nth-of-type(2)', 'hover'); await pair('bell', '.topic:nth-of-type(2) .bell', 'hover'); await pair('bell', '.topic:nth-of-type(2) .bell', 'press');
  await goto('#/topic/greetings'); await pair('primary pill', '.actions .btn.primary', 'hover'); await pair('plain pill', '.actions .btn:nth-of-type(2)', 'hover'); await pair('plain pill', '.actions .btn:nth-of-type(2)', 'press'); await pair('search field', '.actions input', 'hover');
  await goto('#/review'); await w.page.click('.flash'); await sleep(400); await pair('grade pill', '.grades .good', 'hover');
  await goto('#/write'); await pair('tool pill', '.tools .btn', 'hover'); await pair('switch', '.content .switch', 'hover');
  await goto('#/build/order'); await pair('tile', '.pool .tile', 'hover'); await pair('tile', '.pool .tile', 'press');
  await goto('#/settings'); await pair('chip', '.chip:not(.on)', 'hover'); await pair('chip on', '.chip.on', 'hover');
  await w.page.evaluate(() => { document.querySelector('main.content').scrollTop = 420; }); await sleep(200); await pair('slider', '.range', 'hover');
  await goto('#/'); await pair('nav item', '.side a:nth-of-type(3)', 'hover');
  await w.close();

  // Pet: hover on "Biết rồi" and the bubble's light direction.
  const p = await h.open({ label: 'pet', seed: seedFor({ theme, mode, settings: { guessFirst: false } }) });
  await p.page.waitForSelector('.bubble .vi', { timeout: 20000 }); await h.syncPet(p.page); await h.settle(p.page, 400);
  await p.page.evaluate(() => document.body.style.setProperty('background', '#888', 'important'));
  // The bubble's outer 2px are its uniform theme-coloured outline; the glass rim sits just inside it.
  const [br0] = await rectsOf(p.page, [['bubble', '.bubble']]);
  const br = { ...br0, x: br0.x + 2, y: br0.y + 2, w: br0.w - 4, h: br0.h - 4 };
  const b0 = await p.page.screenshot({ encoding: 'base64' });
  out.light.push(...(await p.page.evaluate(edges, b0, [br])).map((r) => ({ page: 'pet', ...r })));
  const [kr] = await rectsOf(p.page, [['Biết rồi', '.bubble .known']]);
  await p.page.hover('.bubble .known'); await sleep(300);
  const b1 = await p.page.screenshot({ encoding: 'base64' });
  out.hover.push(...(await p.page.evaluate(diffRects, b0, b1, [grow(kr, 4)], 0)).map((d) => ({ name: 'pet Biết rồi', ...d })));
  await p.close();
} finally { await h.close(); }

writeFileSync(`${WORK}/proof-${theme}-${mode}.json`, JSON.stringify(out, null, 1));
console.log(`\nR-2 refract vs fallback, 12px bezel band (${theme} ${mode})`);
for (const r of out.refract) console.log(`  ${r.page.padEnd(18)} ${r.name.padEnd(14)} max ${String(r.max).padStart(3)}  mean ${String(r.mean).padStart(6)}  >8: ${r.pctOver8}%`);
console.log('\nR-1 edge luminance (top/bottom/left/right, 1px inside)');
for (const r of out.light) console.log(`  ${r.page.padEnd(18)} ${r.name.padEnd(14)} [${r.rect}] T ${r.top} B ${r.bottom} L ${r.left} R ${r.right}  top>bottom ${r.topBrighter}  left>right ${r.leftBrighter}`);
if (out.wideRim) {
  console.log(`\nRound-2 R-2 wide pane rim, quiz question card at 1400×900 [${out.wideRim.rect.x},${out.wideRim.rect.y} ${out.wideRim.rect.w}x${out.wideRim.rect.h}], luminance of the outermost pixel`);
  for (const edge of ['top', 'left', 'bottom', 'right']) console.log(`  ${edge.padEnd(7)} 10% ${out.wideRim.samples[`${edge} 10%`]}  50% ${out.wideRim.samples[`${edge} 50%`]}  90% ${out.wideRim.samples[`${edge} 90%`]}`);
}
if (out.fold) {
  console.log('\nRound-2 R-11 fold check: smallest step of the sampled position per px into the glass (> 0: no fold)');
  for (const r of out.fold) console.log('  ' + Object.entries(r).map(([k, v]) => `${k} ${v}`).join(' | '));
}
console.log('\nR-6 hover vs default (element box + 4px)');
for (const r of out.hover) console.log(`  ${r.name.padEnd(16)} max ${String(r.max).padStart(3)}  mean ${String(r.mean).padStart(6)}  >8: ${r.pctOver8}%`);
console.log('\nR-23 press vs default');
for (const r of out.press) console.log(`  ${r.name.padEnd(16)} max ${String(r.max).padStart(3)}  mean ${String(r.mean).padStart(6)}  >8: ${r.pctOver8}%`);
