// Renders motion-spec.json with a stick-layer 2D rig (FK + projection, the "twoD" path of the
// convention) into SVG contact sheets with hand trails, then rasterises them with headless Chrome.
// Also writes preview/player.html, a live 30 fps player of every clip (FK code and spec inlined).
// Usage: node preview.mjs [spec.json]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fk, project, clipDuration } from '../../../../../src/lib/rig/fk.js';
import { composite } from '../../../../../src/lib/rig/compose.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(process.argv[2] ?? join(HERE, 'motion-spec.json'), 'utf8'));
const OUT = join(HERE, 'preview');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Cells are the app frame at 1x (139 x 340 px) with the spec's own frame placement.
const PX = spec.frame.pxPerM, OX = spec.frame.originXPx, OY = spec.frame.originYPx, CW = 139, CH = 340, yaw = spec.camera?.yawDeg ?? 0;

function poseAt(sec, t, idleT = 0) {
  const P = composite(spec, sec, t, idleT, true);
  return { pose: P.pose, root: P.hipsOffset, expr: P.expr, gaze: P.gaze };
}

function figure(P, ox, oy, opacity = 1) {
  const W = fk(P.pose, P.root);
  const pt = (b, local) => {
    let p = W[b].p;
    if (local) { const m = W[b].m; p = [0, 1, 2].map((i) => p[i] + m[i * 3] * local[0] + m[i * 3 + 1] * local[1] + m[i * 3 + 2] * local[2]); }
    const q = project(p, yaw);
    return [ox + OX + q[0] * PX, oy + OY - q[1] * PX];
  };
  const line = (a, b, w, c) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  const skin = '#e8b9a0', shirt = '#f4f4f4', skirt = '#8a93a6', dark = '#333';
  const g = [];
  const limb = (bones, w, c) => { for (let i = 0; i + 1 < bones.length; i++) g.push(line(pt(bones[i]), pt(bones[i + 1]), w, c)); };
  // far side first (her right is image left and nearer the camera at +yaw... draw right side last for the arm on top)
  limb(['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'], 18, skin);
  limb(['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'], 18, skin);
  g.push(line(pt('leftFoot'), pt('leftToes'), 9, dark), line(pt('rightFoot'), pt('rightToes'), 9, dark));
  const hipL = pt('leftUpperLeg'), hipR = pt('rightUpperLeg'), shL = pt('leftUpperArm'), shR = pt('rightUpperArm');
  const skL = pt('leftUpperLeg', [0.05, -0.2, 0]), skR = pt('rightUpperLeg', [-0.05, -0.2, 0]);
  g.push(`<polygon points="${[pt('spine', [0.11, 0, 0]), pt('spine', [-0.11, 0, 0]), skR, skL].map((p) => p.join(',')).join(' ')}" fill="${skirt}"/>`);
  g.push(`<polygon points="${[shL, shR, pt('chest', [-0.1, 0, 0]), pt('chest', [0.1, 0, 0])].map((p) => p.join(',')).join(' ')}" fill="${shirt}" stroke="#bbb"/>`);
  g.push(`<polygon points="${[pt('chest', [0.1, 0, 0]), pt('chest', [-0.1, 0, 0]), pt('spine', [-0.1, 0, 0]), pt('spine', [0.1, 0, 0])].map((p) => p.join(',')).join(' ')}" fill="${skin}"/>`);
  void hipL; void hipR;
  g.push(line(pt('neck'), pt('head'), 9, skin));
  const hc = pt('head', [0, 0.1, 0.01]);
  g.push(`<circle cx="${hc[0].toFixed(1)}" cy="${hc[1].toFixed(1)}" r="${0.095 * PX}" fill="${skin}" stroke="#a5754f"/>`);
  g.push(`<path d="M${pt('head', [-0.09, 0.15, 0.03]).join(',')} Q${pt('head', [0, 0.24, 0.05]).join(',')} ${pt('head', [0.09, 0.15, 0.03]).join(',')}" stroke="#8a5a3a" stroke-width="9" fill="none"/>`);
  // eyes: closed by blink weight; gaze shifts the iris
  const blink = Math.min(1, Math.max(0, P.expr.blink ?? 0));
  for (const ex of [-0.035, 0.035]) {
    const e = pt('head', [ex, 0.1, 0.09]);
    const gx = Math.sin(P.gaze[0] * Math.PI / 180) * 3, gy = -Math.sin(P.gaze[1] * Math.PI / 180) * 3;
    if (blink > 0.7) g.push(line([e[0] - 3, e[1]], [e[0] + 3, e[1]], 1.5, dark));
    else g.push(`<ellipse cx="${(e[0] + gx).toFixed(1)}" cy="${(e[1] + gy).toFixed(1)}" rx="1.8" ry="${(2.2 * (1 - blink)).toFixed(2)}" fill="${dark}"/>`);
  }
  const mouthOpen = ['aa', 'oh', 'ou', 'ih', 'ee'].reduce((a, k) => a + Math.max(0, P.expr[k] ?? 0), 0);
  const m = pt('head', [0, 0.055, 0.09]);
  const smile = (P.expr.happy ?? 0) + (P.expr.relaxed ?? 0) * 0.5;
  g.push(`<path d="M${m[0] - 4},${m[1]} Q${m[0]},${m[1] + 2 + smile * 4 + mouthOpen * 6} ${m[0] + 4},${m[1]}" stroke="#b5485a" stroke-width="1.6" fill="${mouthOpen > 0.15 ? '#7a2b3a' : 'none'}"/>`);
  limb(['leftUpperArm', 'leftLowerArm', 'leftHand', 'leftHandTip'], 11, skin);
  limb(['rightUpperArm', 'rightLowerArm', 'rightHand', 'rightHandTip'], 11, skin);
  g.push(line(shL, pt('leftUpperArm', [0.08, 0, 0]), 14, shirt), line(shR, pt('rightUpperArm', [-0.08, 0, 0]), 14, shirt));
  return { svg: `<g opacity="${opacity}">${g.join('')}</g>`, pt };
}

function sections() {
  const out = [];
  for (const [name, clip] of Object.entries(spec.clips)) {
    if (clip.kind === 'stateful') for (const part of ['enter', 'loop', 'exit']) out.push({ label: `${name}.${part}`, name, part, clip: clip[part], parent: clip });
    else out.push({ label: name, name, part: 'oneShot', clip, parent: clip });
  }
  return out;
}

function sheet(sec, fps = 6) {
  const dur = clipDuration(sec.clip);
  const times = [...Array(Math.floor(dur * fps / 1000) + 1).keys()].map((i) => i * 1000 / fps);
  if (times[times.length - 1] < dur - 1) times.push(dur);
  const restP = { pose: spec.rest.bones, root: spec.rest.hipsOffset, expr: spec.rest.expressions, gaze: spec.rest.gaze };
  const edge = figure(restP, 0, 0).pt;
  const restEdgeX = Math.min(...['rightUpperArm', 'rightLowerArm', 'rightHand', 'rightHandTip'].map((b) => edge(b)[0]));
  const cells = [];
  const trail = { left: [], right: [] };
  times.forEach((t, i) => {
    const P = poseAt(sec, t);
    const ox = i * CW;
    const ghost = figure(restP, ox, 0, 0.18).svg;
    const f = figure(P, ox, 0);
    trail.left.push(f.pt('leftHand')); trail.right.push(f.pt('rightHand'));
    cells.push(`<rect x="${ox}" y="0" width="${CW}" height="${CH}" fill="#d8d8d8" stroke="#fff"/>${ghost}<line x1="${ox + restEdgeX}" y1="0" x2="${ox + restEdgeX}" y2="${CH}" stroke="#c33" stroke-dasharray="3 3" stroke-width="0.8"/>${f.svg}<text x="${ox + 4}" y="${CH + 14}" font-size="11" font-family="sans-serif">${Math.round(t)} ms</text>`);
  });
  // hand paths over the whole section on an extra cell (shows arcs vs straight lines)
  const ox = times.length * CW;
  const dense = [...Array(61).keys()].map((k) => poseAt(sec, dur * k / 60));
  const path = (side) => dense.map((P) => figure(P, ox, 0).pt(`${side}Hand`)).map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = figure(restP, ox, 0, 0.35).svg;
  cells.push(`<rect x="${ox}" y="0" width="${CW}" height="${CH}" fill="#eef" stroke="#fff"/>${last}<path d="${path('left')}" stroke="#06c" stroke-width="1.5" fill="none"/><path d="${path('right')}" stroke="#c60" stroke-width="1.5" fill="none"/><text x="${ox + 4}" y="${CH + 14}" font-size="11" font-family="sans-serif">wrist paths</text>`);
  const w = (times.length + 1) * CW, h = CH + 22;
  return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fff"/><text x="4" y="${CH + 14}" dx="${w - 160}" font-size="12" font-weight="bold" font-family="sans-serif">${sec.label} (${dur} ms, ${fps} fps)</text>${cells.join('')}</svg>` };
}

function idleSheet() {
  const sec = { label: 'idle (rest + idle layer only)', name: 'idle', part: 'loop', clip: { bones: {}, durationMs: 9000 }, parent: {} };
  return sheet({ ...sec, clip: { ...sec.clip } }, 1.5);
}

function raster(name, { w, h, svg }, scale = 1) {
  const svgPath = join(OUT, `${name}.svg`), png = join(OUT, `${name}.png`);
  writeFileSync(svgPath, svg);
  if (!existsSync(CHROME)) return null;
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`, `--window-size=${w},${h}`, `--screenshot=${png}`, '--default-background-color=ffffffff', pathToFileURL(svgPath).href], { stdio: 'ignore', timeout: 60000 });
  return png;
}

const made = [];
for (const sec of sections()) made.push(raster(`sheet_${sec.label.replace('.', '_')}`, sheet(sec)));
made.push(raster('sheet_idle', idleSheet()));
made.push(raster('sheet_wave_2x', sheet(sections().find((x) => x.label === 'wave')), 2));

// live player: inline fk.mjs (minus exports) and the spec
const strip = (f) => readFileSync(join(HERE, 'lib', f), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const fkSrc = strip('fk.mjs') + strip('compose.mjs');
const figSrc = figure.toString(), poseSrc = poseAt.toString();
writeFileSync(join(OUT, 'player.html'), `<!doctype html><meta charset="utf-8"><title>Motion Spec Player</title>
<style>body{font:14px sans-serif;margin:16px;background:#f4f4f4}button{margin:2px}svg{background:#d8d8d8}</style>
<div id="b"></div><svg id="s" width="${CW * 2}" height="${CH * 2}" viewBox="0 0 ${CW} ${CH}"></svg><div id="t"></div>
<script>
${fkSrc}
const spec = ${JSON.stringify(spec)};
const PX = ${PX}, OX = ${OX}, OY = ${OY}, CW = ${CW}, CH = ${CH}, yaw = ${yaw};
${poseSrc}
${figSrc}
let seq = [], t0 = performance.now(), idleT0 = performance.now();
function play(name) {
  const c = spec.clips[name];
  seq = c.kind === 'stateful' ? [['enter', c.enter], ['loop', c.loop], ['loop', c.loop], ['exit', c.exit]].map(([part, clip]) => ({ name, part, clip, parent: c })) : [{ name, part: 'oneShot', clip: c, parent: c }];
  t0 = performance.now();
}
for (const n of Object.keys(spec.clips)) { const b = document.createElement('button'); b.textContent = n; b.onclick = () => play(n); document.getElementById('b').append(b); }
const rest = { bones: {}, durationMs: 1e9 };
function frame(now) {
  let t = now - t0, cur = { name: 'idle', part: 'loop', clip: rest, parent: {} };
  for (const s of seq) { const d = clipDuration(s.clip); if (t < d) { cur = s; break; } t -= d; }
  if (cur.clip === rest) { seq = []; t = now - idleT0; }
  const P = poseAt(cur, cur.clip === rest ? 0 : t, now - idleT0 - (cur.clip === rest ? 0 : t));
  document.getElementById('s').innerHTML = figure(P, 0, 0).svg;
  document.getElementById('t').textContent = seq.length ? 'playing' : 'idle layer';
  setTimeout(() => requestAnimationFrame(frame), 1000 / 30 - 1);
}
requestAnimationFrame(frame);
</script>`);
console.log(made.filter(Boolean).length, 'sheets in', OUT);
