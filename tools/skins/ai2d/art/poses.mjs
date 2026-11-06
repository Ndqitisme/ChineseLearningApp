// Samples every clip of the motion spec at 30 fps through the spec's own composer and layer2d,
// and writes the 2D state the art must cover: left arm angles/ratios, head yaw/pitch/roll, in px.
import fs from 'node:fs';
import { sectionsOf, composite } from '../motion-v1/lib/compose.mjs';
import { layerState } from '../motion-v1/lib/layer2d.mjs';
import { clipDuration } from '../motion-v1/lib/fk.mjs';
const spec = JSON.parse(fs.readFileSync(new URL('../motion-v1/motion-spec.json', import.meta.url)));
const yaw = spec.camera.yawDeg, F = spec.frame;
const px = (x, y) => [F.originXPx + x * F.pxPerM, F.originYPx - y * F.pxPerM];
function state(P) {
  const L = layerState(P, yaw);
  const o = { turns: L.turns, limbs: {} };
  for (const [k, v] of Object.entries(L.limbs)) { const [x, y] = px(v.x, v.y); o.limbs[k] = { x: +x.toFixed(2), y: +y.toFixed(2), angle: +(-v.angle).toFixed(2), ratio: +v.ratio.toFixed(3), depth: v.depth }; }
  const h = L.turns.head; o.head = { x: +px(h.x, h.y)[0].toFixed(2), y: +px(h.x, h.y)[1].toFixed(2), yaw: +h.yaw.toFixed(2), pitch: +h.pitch.toFixed(2), roll: +h.roll.toFixed(2) };
  return o;
}
const rest = state(composite(spec, { name: 'rest', part: 'loop', clip: {}, parent: {} }, 0, 0, false));
const out = { rest, clips: {} };
for (const s of sectionsOf(spec)) {
  const dur = clipDuration(s.clip), fr = [];
  for (let t = 0; t <= dur; t += 1000 / 30) { const P = composite(spec, s, t, 0, false); const st = state(P); fr.push({ t: Math.round(t), fingers: P.fingers.left, head: st.head, la: ['leftUpperArm', 'leftForearm', 'leftHand'].map((k) => st.limbs[k]) }); }
  out.clips[`${s.name}.${s.part}`] = fr;
}
fs.writeFileSync(new URL('./work/poses.json', import.meta.url), JSON.stringify(out));
const r = rest;
console.log('rest head', JSON.stringify(r.head));
for (const k of ['leftUpperArm', 'leftForearm', 'leftHand', 'rightUpperArm', 'rightForearm', 'rightHand']) console.log('rest', k, JSON.stringify(r.limbs[k]));
for (const [name, fr] of Object.entries(out.clips)) {
  // most extreme left-arm frame = max summed angular deviation from rest
  let best = null, bd = -1, hy = [1e9, -1e9], hp = [1e9, -1e9];
  for (const f of fr) {
    const d = f.la.reduce((s, l, i) => s + Math.abs(((l.angle - r.limbs[['leftUpperArm', 'leftForearm', 'leftHand'][i]].angle + 540) % 360) - 180), 0);
    if (d > bd) { bd = d; best = f; }
    hy = [Math.min(hy[0], f.head.yaw), Math.max(hy[1], f.head.yaw)]; hp = [Math.min(hp[0], f.head.pitch), Math.max(hp[1], f.head.pitch)];
  }
  console.log(name.padEnd(16), 't', best.t, 'dev', bd.toFixed(0), 'arm', best.la.map((l) => `${l.angle.toFixed(0)}/${l.ratio.toFixed(2)}${l.depth > 0 ? '+' : '-'}`).join(' '), 'fing', best.fingers.map((v) => v.toFixed(2)).join(','), 'headYaw', hy.map((v) => v.toFixed(1)).join('..'), 'pitch', hp.map((v) => v.toFixed(1)).join('..'));
}
