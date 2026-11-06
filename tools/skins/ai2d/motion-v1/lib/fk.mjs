// Shared skeleton, rotation convention, curve evaluation and forward kinematics.
// The convention is the one declared in motion-spec.json "convention":
//   VRM 1.0 normalized humanoid. Rest reference = T-pose with every bone rotation identity.
//   World axes: +Y up, +Z the way she faces, +X her left. Angles are degrees, Euler order XYZ
//   in three.js's sense (matrix = Rx * Ry * Rz), applied in the bone's normalized local space.
//   Final local Euler = rest + idle-layer delta + action delta, channel by channel.

export const D2R = Math.PI / 180;

// Offsets from parent joint in metres, T-pose, for a 1.60 m figure (Drillis-Contini segment
// ratios: upper arm 0.186H shoulder-elbow taken as 0.28, forearm 0.146H = 0.23, hand 0.108H = 0.17).
export const BONES = {
  hips: [null, [0, 0.92, 0]],
  spine: ['hips', [0, 0.08, 0]],
  chest: ['spine', [0, 0.12, 0]],
  upperChest: ['chest', [0, 0.12, 0]],
  neck: ['upperChest', [0, 0.12, 0]],
  head: ['neck', [0, 0.08, 0]],
  headTop: ['head', [0, 0.2, 0]],
  leftShoulder: ['upperChest', [0.03, 0.06, 0]],
  leftUpperArm: ['leftShoulder', [0.14, 0.0, 0]],
  leftLowerArm: ['leftUpperArm', [0.28, 0, 0]],
  leftHand: ['leftLowerArm', [0.23, 0, 0]],
  leftHandTip: ['leftHand', [0.17, 0, 0]],
  rightShoulder: ['upperChest', [-0.03, 0.06, 0]],
  rightUpperArm: ['rightShoulder', [-0.14, 0.0, 0]],
  rightLowerArm: ['rightUpperArm', [-0.28, 0, 0]],
  rightHand: ['rightLowerArm', [-0.23, 0, 0]],
  rightHandTip: ['rightHand', [-0.17, 0, 0]],
  leftUpperLeg: ['hips', [0.09, -0.06, 0]],
  leftLowerLeg: ['leftUpperLeg', [0, -0.4, 0]],
  leftFoot: ['leftLowerLeg', [0, -0.42, 0]],
  leftToes: ['leftFoot', [0, -0.04, 0.13]],
  rightUpperLeg: ['hips', [-0.09, -0.06, 0]],
  rightLowerLeg: ['rightUpperLeg', [0, -0.4, 0]],
  rightFoot: ['rightLowerLeg', [0, -0.42, 0]],
  rightToes: ['rightFoot', [0, -0.04, 0.13]],
};
/** Bones that carry rotations (end points like headTop / handTip / toes are sites only). */
export const ROTATING = Object.keys(BONES).filter((b) => !/Top$|Tip$|Toes$/.test(b));

const mul = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export function euler([x, y, z]) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * D2R), Math.sin(x * D2R), Math.cos(y * D2R), Math.sin(y * D2R), Math.cos(z * D2R), Math.sin(z * D2R)];
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(mul(Rx, Ry), Rz);
}

/** World joint positions for a pose {bone: [x,y,z] degrees}. hipsOffset [x,y,z] metres optional. */
export function fk(pose, hipsOffset = [0, 0, 0]) {
  const world = {};
  for (const [name, [parent, off]] of Object.entries(BONES)) {
    const rot = euler(pose[name] ?? [0, 0, 0]);
    if (!parent) {
      world[name] = { p: off.map((v, i) => v + hipsOffset[i]), m: rot };
    } else {
      const P = world[parent];
      const o = apply(P.m, off);
      world[name] = { p: [P.p[0] + o[0], P.p[1] + o[1], P.p[2] + o[2]], m: mul(P.m, rot) };
    }
  }
  return world;
}

/** Image-plane projection: camera on +Z looking at -Z, turned `yaw` degrees so her forward (+Z) shows toward image right. x right, y up. */
export function project(p, yaw = 0) {
  const c = Math.cos(yaw * D2R), s = Math.sin(yaw * D2R);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}

// ---------------------------------------------------------------- curves
// A track is a list of keys [tMs, value, flags?]. Values are numbers (one channel) or arrays.
// Interpolation is monotone cubic Hermite (Fritsch-Carlson) per channel; the tangent is zero at
// the first and last key and at any key whose flags contain "h" (a held key). Before the first
// key the first value holds, after the last the last value holds.
function tangents(ts, vs, flags) {
  const n = ts.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  for (let i = 1; i < n - 1; i++) {
    if (flags[i]?.includes('h') || d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * (ts[i + 1] - ts[i]) + (ts[i] - ts[i - 1]), w2 = (ts[i + 1] - ts[i]) + 2 * (ts[i] - ts[i - 1]);
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return m;
}
const cache = new WeakMap();
export function sampleTrack(track, t) {
  const n = track.length;
  const dims = Array.isArray(track[0][1]) ? track[0][1].length : 0;
  if (t <= track[0][0]) return track[0][1];
  if (t >= track[n - 1][0]) return track[n - 1][1];
  let pre = cache.get(track);
  if (!pre) {
    const ts = track.map((k) => k[0]), flags = track.map((k) => k[2] ?? '');
    const chans = dims ? [...Array(dims).keys()].map((c) => track.map((k) => k[1][c])) : [track.map((k) => k[1])];
    pre = { ts, chans, ms: chans.map((vs) => tangents(ts, vs, flags)) };
    cache.set(track, pre);
  }
  const { ts, chans, ms } = pre;
  let i = 0;
  while (ts[i + 1] < t) i++;
  const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  const out = chans.map((vs, c) => h00 * vs[i] + h10 * h * ms[c][i] + h01 * vs[i + 1] + h11 * h * ms[c][i + 1]);
  return dims ? out : out[0];
}

/** Idle layer value at time t (ms): sum of sines per channel, see spec.idle.layers. */
export function idleAt(idle, t, weightOf = () => 1) {
  const pose = {}, expr = {};
  for (const layer of idle.layers) {
    // A coupled layer (weight sway: hips roll + thigh counter-roll) takes one weight, the smallest of
    // its bones, so muting one part never leaves the other to slide the feet.
    const lw = layer.coupled ? Math.min(...Object.keys(layer.channels).filter((c) => !c.startsWith('expr:')).map(weightOf)) : null;
    for (const [ch, amps] of Object.entries(layer.channels)) {
      const phase = 2 * Math.PI * (t / layer.periodMs) + (layer.phase ?? 0);
      // Breath: asymmetric (in-breath 40 %, out-breath 60 %) via a phase warp; others plain sines.
      const s = layer.shape === 'breath' ? breathWave(t / layer.periodMs + (layer.phase ?? 0) / (2 * Math.PI)) : Math.sin(phase);
      if (ch.startsWith('expr:')) { const k = ch.slice(5); expr[k] = (expr[k] ?? 0) + amps * s; continue; }
      const w = lw ?? weightOf(ch);
      const v = pose[ch] ?? [0, 0, 0];
      pose[ch] = v.map((x, i) => x + amps[i] * s * w);
    }
  }
  return { pose, expr };
}
/** 0..1..0 breath curve over one period: rise in 40 % of the cycle, slower fall, short rest at the bottom. */
export function breathWave(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.4) return 0.5 - 0.5 * Math.cos(Math.PI * p / 0.4);
  if (p < 0.9) return 0.5 + 0.5 * Math.cos(Math.PI * (p - 0.4) / 0.5);
  return 0;
}

/** Action delta pose + expressions + gaze at time t. */
export function actionAt(clip, t) {
  const pose = {}, expr = {};
  for (const [bone, track] of Object.entries(clip.bones ?? {})) pose[bone] = sampleTrack(track, t);
  for (const [k, track] of Object.entries(clip.expressions ?? {})) expr[k] = sampleTrack(track, t);
  const gaze = clip.gaze ? sampleTrack(clip.gaze, t) : [0, 0];
  const root = clip.hipsOffset ? sampleTrack(clip.hipsOffset, t) : [0, 0, 0];
  return { pose, expr, gaze, root };
}

export function addPose(...poses) {
  const out = {};
  for (const p of poses) for (const [b, v] of Object.entries(p)) out[b] = (out[b] ?? [0, 0, 0]).map((x, i) => x + v[i]);
  return out;
}

export function clipDuration(clip) {
  let end = 0;
  const scan = (tr) => { end = Math.max(end, tr[tr.length - 1][0]); };
  Object.values(clip.bones ?? {}).forEach(scan);
  Object.values(clip.expressions ?? {}).forEach(scan);
  if (clip.gaze) scan(clip.gaze);
  if (clip.hipsOffset) scan(clip.hipsOffset);
  return clip.durationMs ?? end;
}
