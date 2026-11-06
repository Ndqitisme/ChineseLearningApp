// Generates motion-spec.json from readable intent: arm keys are given as wrist / elbow / fingertip
// targets in metres and solved to Euler angles (lib/ik.mjs, warm-started so twist never flips
// between keys); torso, head, legs, expressions and gaze are authored directly as deltas.
// Usage: node gen_spec.mjs [out.json]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fk, project, clipDuration, sampleTrack } from '../../../../../src/lib/rig/fk.js';
import { solveArm, plantFeet, search } from './lib/ik.mjs';
import { centreOfMass, supportOf, pelvisSection, toWorld, toLocal } from './lib/body.mjs';
import { composite, sectionsOf } from '../../../../../src/lib/rig/compose.js';
import { layerState, ladderFor, LIMB_PARTS } from '../../../../../src/lib/rig/layer2d.js';
import { FRAME, TWO_D, BUDGET } from './lib/limits.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, 'motion-spec.json');
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const sub = (a, b) => a.map((x, i) => r1(x - b[i]));
const add = (a, b) => a.map((x, i) => x + b[i]);

// ---------------------------------------------------------------- rest pose
// Two-foot stance: both feet planted
// under the hips about hip width apart, toes slightly out, knees straight but relaxed. The pelvis is
// level. The only weight shift is the slow idle sway (weightSway below), with both feet down.
const KNEE0 = 4, TOE_OUT = 8, FEET_APART = 0.2;
const TORSO0 = {
  hips: [0, 0, 0], spine: [0, 0, 0.6], chest: [0, 0, 0.3], upperChest: [0, 0, 0],
  neck: [1.5, 1, -1], head: [3, 2, 0.5],
  leftShoulder: [0, 0, 1], rightShoulder: [0, 0, 1],
};
const STANCE_OFFSET = [0, -0.004, 0];
// Solve the legs, mirrored: q = [upperLeg x, right upperLeg z, foot x]. The supports sit FEET_APART
// apart, the centre of mass over their midpoint fore and aft, the soles flat; the foot z undoes the leg's
// roll so the sole is level side to side; foot y turns the toes out.
const legsOf = (q) => ({
  rightUpperLeg: [q[0], 0, q[1]], rightLowerLeg: [KNEE0, 0, 0], rightFoot: [q[2], -TOE_OUT, -q[1]],
  leftUpperLeg: [q[0], 0, -q[1]], leftLowerLeg: [KNEE0, 0, 0], leftFoot: [q[2], TOE_OUT, q[1]],
});
const STANCE = (() => {
  const mk = (q) => ({ ...TORSO0, ...legsOf(q) });
  const cost = (q) => {
    const W = fk(mk(q), STANCE_OFFSET), C = centreOfMass(W), L = supportOf(W, 'leftFoot'), R = supportOf(W, 'rightFoot');
    const flat = (side) => W[`${side}Foot`].p[1] - W[`${side}Toes`].p[1] - 0.04;
    return 100 * (C[2] - (L[2] + R[2]) / 2) ** 2 + 100 * (L[0] - R[0] - FEET_APART) ** 2 + 50 * (flat('left') ** 2 + flat('right') ** 2) + 1e-5 * (q[0] ** 2 + q[1] ** 2);
  };
  return mk(search([-2, -1, 2], cost, 20000, 2).map(r1));
})();

// Weight sway: the pelvis shifts toward one foot and drops on the other side; the unloaded knee softens,
// the loaded leg stays straight, both feet stay put. Solved by IK at 16 phases (lib/ik.mjs plantFeet),
// then fitted per channel as mean + A*sin(x) + B*cos(2x) (the knee of the unloaded side bends only on
// its half of the cycle, so a single sine cannot plant the feet). The means become the rest legs; the A
// terms ride the 8.4 s layer and the B terms a 4.2 s layer locked to it (phase 2*phi + pi/2).
const SWAY = { kneeDeg: 10, shiftM: 0.006, spineK: 0.6, chestK: 0.35, phase: 0.8 };
const SWAY_LEGS = ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot'];
// Leg length (hip to ankle) at a knee flex, on the reference skeleton.
const legLen = (kneeDeg) => { const a = 0.4, b = 0.42, k = kneeDeg * Math.PI / 180; return Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(k)); };
const HIP_W = 0.18;
const swayFit = (() => {
  const N = 16, rows = [];
  for (let k = 0; k < N; k++) {
    const x = (2 * Math.PI * k) / N, sv = Math.sin(x);
    // s > 0: weight onto her right foot; the left knee softens by kneeDeg * s and the left hip drops by the
    // leg it loses; the pelvis rolls and shifts toward the right foot. s < 0 mirrors it.
    const kL = KNEE0 + SWAY.kneeDeg * Math.max(0, sv), kR = KNEE0 + SWAY.kneeDeg * Math.max(0, -sv);
    const dropL = legLen(KNEE0) - legLen(kL), dropR = legLen(KNEE0) - legLen(kR);
    const roll = Math.atan2(dropR - dropL, HIP_W) * 180 / Math.PI;      // + lifts her left hip
    const torso = { hips: [0, 0, roll], spine: add(STANCE.spine, [0, 0, -SWAY.spineK * roll]), chest: add(STANCE.chest, [0, 0, -SWAY.chestK * roll]) };
    const off = add(STANCE_OFFSET, [-SWAY.shiftM * sv, -(dropL + dropR) / 2, 0]);
    const sol = plantFeet(STANCE, STANCE_OFFSET, torso, off, { left: kL, right: kR });
    const legs = {};
    for (const side of ['left', 'right']) { legs[`${side}UpperLeg`] = sol[side].upperLeg; legs[`${side}LowerLeg`] = sol[side].lowerLeg; legs[`${side}Foot`] = sol[side].foot; }
    rows.push({ x, legs, off, torso });
  }
  // least squares on the orthogonal basis 1, sin x, cos 2x over equally spaced phases
  const fit = (get) => {
    let m = 0, a = 0, b = 0;
    for (const r of rows) { const v = get(r); m += v / N; a += (2 / N) * v * Math.sin(r.x); b += (2 / N) * v * Math.cos(2 * r.x); }
    return [m, a, b];
  };
  const out = { mean: {}, A: {}, B: {} };
  for (const bone of SWAY_LEGS) {
    const f = [0, 1, 2].map((c) => fit((r) => r.legs[bone][c]));
    out.mean[bone] = f.map((v) => r1(v[0])); out.A[bone] = f.map((v) => r3(v[1])); out.B[bone] = f.map((v) => r3(v[2]));
  }
  for (const bone of ['hips', 'spine', 'chest']) {
    const f = [0, 1, 2].map((c) => fit((r) => r.torso[bone][c]));
    out.A[bone] = f.map((v) => r3(v[1])); out.B[bone] = f.map((v) => r3(v[2]));
  }
  const fo = [0, 1, 2].map((c) => fit((r) => r.off[c]));
  out.mean.hipsOffset = fo.map((v) => r3(v[0])); out.A.hipsOffset = fo.map((v) => Math.round(v[1] * 1e5) / 1e5); out.B.hipsOffset = fo.map((v) => Math.round(v[2] * 1e5) / 1e5);
  return out;
})();
const TORSO = { ...STANCE, ...Object.fromEntries(SWAY_LEGS.map((b) => [b, swayFit.mean[b]])) };
const HIPS_OFFSET = swayFit.mean.hipsOffset;

// Left hand on the hip: the heel of the hand on the iliac crest (wrist centre 2.5 cm off the
// pelvis surface), fingertips forward-down lying on the hip 6 mm off the surface, elbow out and
// back. Points are placed on the pelvis profile in the hips frame, so the contact is exact.
const HIP_GOAL = (() => {
  const W = fk(TORSO);
  const crest = pelvisSection(0.07);
  const wrist = toWorld(W.hips, [crest[0] + 0.027, 0.075, -0.01]);
  let best = null;
  for (let yi = -14; yi <= 4; yi++) for (let th = 20; th <= 80; th++) {
    const y = yi * 0.005, s = pelvisSection(y), a = th * Math.PI / 180;
    const p = toWorld(W.hips, [(s[0] + 0.009) * Math.cos(a), y, (s[1] + 0.009) * Math.sin(a)]);
    const d = Math.hypot(p[0] - wrist[0], p[1] - wrist[1], p[2] - wrist[2]);
    const score = Math.abs(th - 55) + Math.abs(y + 0.03) * 300;
    if (Math.abs(d - 0.17) < 0.003 && (!best || score < best.score)) best = { p, score };
  }
  return { wrist: wrist.map(r3), elbow: toWorld(W.hips, [0.36, 0.21, -0.08]).map(r3), tip: best.p.map(r3) };
})();
const GOALS = {
  hip: HIP_GOAL,
  // Right arm hanging relaxed: elbow ~17 deg, hand just off the thigh, palm to the thigh.
  hang: { wrist: [-0.235, 0.79, 0.015], elbow: [-0.22, 1.03, -0.03], tip: [-0.227, 0.625, 0.045] },
};
const nearHip = (dw, dt = dw, de = [0, 0, 0]) => ({ wrist: add(GOALS.hip.wrist, dw).map(r3), elbow: add(GOALS.hip.elbow, de).map(r3), tip: add(GOALS.hip.tip, dt).map(r3) });
// Anticipation: the hand presses into the hip before it lifts. Settle: it lands a little low and
// forward, then slides into place (follow-through).
// Between the hip and a raised gesture the hand drops off the hip first and the arm hangs a moment at the side
// (gestures start at the shoulder; the 2D rig has a hanging-arm drawing for this stretch, so the
// forearm never sweeps across the belly between two drawings that cannot show it).
const DROP = { wrist: [0.25, 0.85, 0.04], elbow: [0.24, 1.045, -0.02] };
// ... and the forearm turns up (or comes down) on the outside, level for a moment, not across the belly
const ARM_OUT = { wrist: [0.34, 1.05, 0.15], elbow: [0.29, 1.04, -0.02] };
// Think, hair tuck and happy do not drop to the side first. The hand rises straight from the hip in front of
// the body, through two in-between drawings the rig has (rig/inbetween: "front", elbow at the side and the loose hand at the chest; "tuckmid", elbow forward and
// the hand beside the neck). The goals below are placed so the spec's projected bone angles match those drawings.
const FRONT = { wrist: [0.035, 1.165, 0.21], elbow: [0.15, 1.06, 0.05], tip: [-0.06, 1.168, 0.22] };
const TUCKMID = { wrist: [0.105, 1.305, 0.13], elbow: [0.165, 1.07, 0.15], tip: [0.08, 1.435, 0.09] };
// coming down from FRONT the hand passes in front of the belly, not through it, on its way to the hip
const INFRONT = nearHip([0.0, 0.035, 0.075], [0.0, 0.035, 0.085], [-0.01, 0.01, 0.03]);
const PRESS = nearHip([0, -0.006, 0.002], [0, -0.006, 0.003], [0.01, 0, -0.02]);
const SETTLE = nearHip([0.002, -0.01, 0.005], [0.002, -0.01, 0.006], [0, -0.005, 0.01]);
const LIFT = { wrist: add(GOALS.hip.wrist, [0, 0.006, 0.012]).map(r3), elbow: add(GOALS.hip.elbow, [0.01, 0.01, 0.01]).map(r3), tip: add(GOALS.hip.tip, [0.004, 0.006, 0.016]).map(r3) };
const LEFT_START = [0, 20, -70, -60, 0, 0];
const RIGHT_START = [0, -5, 75, 10, 0, 0];

function armAbs(side, goal, base, start) {
  return solveArm(base, side, goal, start);
}
const REST_L = armAbs('left', GOALS.hip, TORSO, LEFT_START);
const REST_R = armAbs('right', GOALS.hang, TORSO, RIGHT_START);
const REST_ABS = {
  ...TORSO,
  leftUpperArm: REST_L.upperArm, leftLowerArm: REST_L.lowerArm, leftHand: REST_L.hand,
  rightUpperArm: REST_R.upperArm, rightLowerArm: REST_R.lowerArm, rightHand: REST_R.hand,
};
const REST_FINGERS = { left: [0.45, 0.1, 0.3], right: [0.3, 0.05, 0.2] };
const REST_EXPR = { relaxed: 0.25 };

// ---------------------------------------------------------------- authoring helpers
const ZERO = [0, 0, 0];
/** Arm tracks from keys [t, goal | 'rest', flags]. handLag (ms) delays the hand track so the hand trails the forearm. */
function arm(side, keys, { handLag = 0, torso = {} } = {}) {
  const rest = side === 'left' ? REST_L : REST_R;
  let start = null;
  const up = [], lo = [], hd = [];
  const base = { ...TORSO, ...Object.fromEntries(Object.entries(torso).map(([b, v]) => [b, add(TORSO[b] ?? ZERO, v)])) };
  for (const [t, goal, flags] of keys) {
    let sol = rest;
    if (goal !== 'rest') {
      sol = armAbs(side, goal, base, start ?? [...rest.upperArm, rest.lowerArm[1], rest.hand[1], rest.hand[2]]);
      if (process.env.IKLOG) console.log(side, t, sol.wristMissM.toFixed(3), sol.tipMissM.toFixed(3), sol.elbowAt.join(' '));
      if (sol.wristMissM > 0.02) throw new Error(`${side} arm key at ${t} ms misses its wrist target by ${sol.wristMissM.toFixed(3)} m`);
      start = [...sol.upperArm, sol.lowerArm[1], sol.hand[1], sol.hand[2]];
    }
    const f = flags ? [flags] : [];
    up.push([t, sub(sol.upperArm, rest.upperArm), ...f]);
    lo.push([t, sub(sol.lowerArm, rest.lowerArm), ...f]);
    hd.push([t + (t > 0 && t < keys[keys.length - 1][0] ? handLag : 0), sub(sol.hand, rest.hand), ...f]);
  }
  const P = side === 'left' ? 'left' : 'right';
  return { [`${P}UpperArm`]: up, [`${P}LowerArm`]: lo, [`${P}Hand`]: hd };
}
/** Same timing, scaled values: for neck/head shares and lagging followers. */
const scaled = (track, k, lag = 0, end) => track.map(([t, v, f], i) => {
  const tt = i === 0 || i === track.length - 1 ? t : Math.min(t + lag, (end ?? track[track.length - 1][0]) - 40);
  return f ? [tt, v.map((x) => r1(x * k)), f] : [tt, v.map((x) => r1(x * k))];
});
/** Knee dip with the feet planted: hips drop d metres, legs re-solved so ankles and toes stay put.
 *  Returns deltas from rest keyed for the leg tracks. */
function dip(d) {
  const sol = plantFeet(REST_ABS, HIPS_OFFSET, {}, add(HIPS_OFFSET, [0, -d, 0]));
  const del = (side, part, bone) => sub(sol[side][part], REST_ABS[bone]);
  return { hipsOffset: [0, -d, 0],
    lUp: del('left', 'upperLeg', 'leftUpperLeg'), lLo: del('left', 'lowerLeg', 'leftLowerLeg'), lFt: del('left', 'foot', 'leftFoot'),
    rUp: del('right', 'upperLeg', 'rightUpperLeg'), rLo: del('right', 'lowerLeg', 'rightLowerLeg'), rFt: del('right', 'foot', 'rightFoot') };
}

// ---------------------------------------------------------------- idle layer
const SWAY_COUPLED = ['hips', 'hipsOffset', ...SWAY_LEGS];
// While she stands idle one frame is held and she moves only in events.
// Each layer belongs to an event kind and moves only inside that kind's windows of idle.schedule (lib/fk.mjs
// idleAt); between events the pose is exactly rest, so the rig presents nothing new.
const SWAY_PERIOD = 8400;
const swayStart = (sign) => Math.round((((2 * Math.PI - SWAY.phase) / (2 * Math.PI)) * SWAY_PERIOD + (sign < 0 ? SWAY_PERIOD / 2 : 0)) % SWAY_PERIOD);
const idleSchedule = (() => {
  // deterministic: a fixed LCG seed, so the spec bytes never change between runs
  let x = 20261105;
  const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
  const CYCLE = 120000, events = [];
  let t = 2500, last = '', sign = 1;
  while (t < CYCLE - 7000) {
    const r = rnd();
    let kind = r < 0.45 ? 'breath' : r < 0.75 ? 'weightShift' : 'glance';
    if (kind === last && kind !== 'breath') kind = 'breath';
    let ev;
    if (kind === 'breath') ev = { kind, at: t, dur: 4200 };
    else if (kind === 'weightShift') { ev = { kind, at: t, dur: SWAY_PERIOD / 2, offsetMs: swayStart(sign) }; sign = -sign; }
    else {
      const ay = (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rnd()), ap = (rnd() - 0.5) * 0.8;
      ev = { kind, at: t, dur: 1600 + Math.round(600 * rnd()), amp: { headDriftYaw: r3(ay), headDriftPitch: r3(ap) } };
    }
    events.push(ev);
    last = kind;
    t += ev.dur + 5000 + Math.round(6000 * rnd());
  }
  return { cycleMs: CYCLE, events };
})();
const idle = {
  note: 'Idle is a held frame plus events. Every layer moves only inside the windows of its event kind in schedule (breath, weightShift, glance); between events the pose is exactly rest and the rig presents nothing. Blinks (events.blink) and the idle clips (stateMachine idleTick) are the other events. A clip lowers the layers per bone with idleWeight (bones it drives default to drivenWeight, bones it does not drive keep 1). At every section end that touches rest, the weight ramps between 1 and the clip weight over rampMs with smoothstep, so the pose never steps when a clip starts or ends (lib/compose.mjs idleBlend).',
  rampMs: 250, drivenWeight: 0.35, easeFrac: 0.3,
  layers: [
    { name: 'breath', event: 'breath', shape: 'breath', periodMs: 4200, channels: {
      chest: [-1.4, 0, 0], upperChest: [-1.0, 0, 0], neck: [1.1, 0, 0], head: [1.0, 0, 0],
      leftShoulder: [0, 0, 1.4], rightShoulder: [0, 0, -1.4],
      rightUpperArm: [0, 0, 1.4], leftUpperArm: [0, 0, -1.4] } },
    // Weight shift, two locked layers (see swayFit): the pelvis shifts toward one foot and drops on the other
    // side, the unloaded knee softens, both feet stay planted. One event is half a sway period: over to one
    // side and back to centre; consecutive shifts alternate sides (offsetMs).
    { name: 'weightSway', event: 'weightShift', periodMs: SWAY_PERIOD, phase: SWAY.phase, coupled: SWAY_COUPLED, channels: {
      hips: swayFit.A.hips, spine: swayFit.A.spine, chest: swayFit.A.chest,
      hipsOffset: swayFit.A.hipsOffset, ...Object.fromEntries(SWAY_LEGS.map((b) => [b, swayFit.A[b]])) } },
    { name: 'weightSwayKnees', event: 'weightShift', periodMs: SWAY_PERIOD / 2, phase: r3(2 * SWAY.phase + Math.PI / 2), coupled: SWAY_COUPLED, channels: {
      hips: swayFit.B.hips, spine: swayFit.B.spine, chest: swayFit.B.chest,
      hipsOffset: swayFit.B.hipsOffset, ...Object.fromEntries(SWAY_LEGS.map((b) => [b, swayFit.B[b]])) } },
    // Glance: the head turns a few degrees toward something and comes back (amp per event, signed).
    { name: 'headDriftYaw', event: 'glance', shape: 'bump', channels: { head: [0, 6, 1.2], neck: [0, 2.2, 0] } },
    { name: 'headDriftPitch', event: 'glance', shape: 'bump', channels: { head: [3, 0, 1.3], neck: [1.0, 0, 0] } },
  ],
  schedule: idleSchedule,
  events: {
    blink: { clip: 'blink', intervalMs: [2000, 6000], doubleChance: 0.15, doubleGapMs: 260,
      note: 'Uniform 2-6 s gives ~15 blinks/min (adult resting rate 15-20/min, guess-level source). Skipped while sleep owns the eyelids.' },
    saccade: { onlyIn: 'glance', intervalMs: [1200, 3500], yawDeg: [-4, 4], pitchDeg: [-2.5, 2.5], eyeMoveMs: 45,
      headFollow: { share: 0.3, delayMs: 150, durationMs: 420 },
      note: 'Eyes jump first (45 ms), head follows 30 % of the gaze change after 150 ms over 420 ms (eye-head coordination).' },
  },
  spriteBake: {
    note: 'Degraded sprite fallback only (not shipped). A sprite cannot add layers per bone: breath becomes 4 body frames; weight sway and head drift are lost. The checker reports what this costs (fallback block). The shipped layered2d rig evaluates the idle layer live, so sway, drift and breath all run.',
    breathFrames: 4, cssBreathScaleY: 0.004,
  },
};

// The left hand stays on the hip while the chest breathes and the pelvis sways: the arm absorbs
// the motion. hipHold(torso delta) re-solves the left arm so the wrist, fingertip and elbow keep
// their place in the hips frame; the idle layers carry the result as left-arm channels.
function hipHold(delta) {
  const base = { ...REST_ABS };
  for (const [b, a] of Object.entries(delta)) if (!/^left(UpperArm|LowerArm|Hand)$|^hipsOffset$/.test(b)) base[b] = add(base[b] ?? ZERO, a);
  const W0 = fk(REST_ABS), Wb = fk(base);
  const keep = (site) => toWorld(Wb.hips, toLocal(W0.hips, W0[site].p)).map((x) => Math.round(x * 1e4) / 1e4);
  const sol = solveArm(base, 'left', { wrist: keep('leftHand'), tip: keep('leftHandTip'), elbow: keep('leftLowerArm') }, [...REST_L.upperArm, REST_L.lowerArm[1], REST_L.hand[1], REST_L.hand[2]]);
  return { leftUpperArm: sub(sol.upperArm, REST_L.upperArm), leftLowerArm: sub(sol.lowerArm, REST_L.lowerArm), leftHand: sub(sol.hand, REST_L.hand) };
}
for (const name of ['breath', 'weightSway']) {
  const layer = idle.layers.find((l) => l.name === name);
  delete layer.channels.leftUpperArm;
  Object.assign(layer.channels, hipHold(layer.channels));
}

// ---------------------------------------------------------------- clips
const clips = {};
const expr = (o) => o;

// blink: lids close fast, open slower. Expression only.
clips.blink = { kind: 'oneShot', agreed: 'blink', bakeFps: 20, layer: 'face',
  expressions: { blink: [[0, 0], [70, 1], [110, 1, 'h'], [260, 0]] } };

// breathe: a deliberate deep breath (the steady breath lives in the idle layer).
clips.breathe = { kind: 'oneShot', agreed: 'breathe', bakeFps: 8,
  bones: {
    chest: [[0, ZERO], [1100, [-4, 0, 0]], [1500, [-4.3, 0, 0]], [2600, [0.8, 0, 0]], [3100, ZERO]],
    upperChest: [[0, ZERO], [1150, [-2.5, 0, 0]], [1550, [-2.7, 0, 0]], [2650, [0.5, 0, 0]], [3100, ZERO]],
    leftShoulder: [[0, ZERO], [1150, [0, 0, 3]], [1500, [0, 0, 3.2]], [2650, [0, 0, -1]], [3100, ZERO]],
    rightShoulder: [[0, ZERO], [1150, [0, 0, -3]], [1500, [0, 0, -3.2]], [2650, [0, 0, 1]], [3100, ZERO]],
    // the right arm counter-rotates so a shoulder lift raises it without swinging it out; the left arm holds the hip (below)
    rightUpperArm: [[0, ZERO], [1150, [0, 0, 3]], [1500, [0, 0, 3.2]], [2650, [0, 0, -1]], [3100, ZERO]],
    neck: [[0, ZERO], [1100, [2, 0, 0]], [1600, [2, 0, 0]], [2600, [1.5, 0, 0]], [3100, ZERO]],
    head: [[0, ZERO], [1100, [1.8, 0, 0]], [1600, [2.2, 0, 0]], [2700, [3.5, 0, 0]], [3100, ZERO]],
  },
  expressions: { relaxed: [[0, 0], [1500, 0.1], [2600, 0.25], [3100, 0]], blink: [[0, 0], [1600, 0], [2100, 0.35], [2700, 0.2], [3100, 0]] },
  idleWeight: { chest: 0.2, upperChest: 0.2, leftShoulder: 0.2, rightShoulder: 0.2, leftUpperArm: 0.2, leftLowerArm: 0.2, leftHand: 0.2 } };
{
  const B = clips.breathe.bones, keys = [0, 600, 1150, 1500, 2100, 2650, 3100];
  const held = keys.map((t) => [t, hipHold(Object.fromEntries(Object.entries(B).map(([b, tr]) => [b, sampleTrack(tr, t)])))]);
  for (const b of ['leftUpperArm', 'leftLowerArm', 'leftHand']) B[b] = held.map(([t, h], i) => [t, i === 0 || i === held.length - 1 ? ZERO : h[b]]);
}

// look: eyes lead, head follows, chest follows the head; glance to the edge side, then across.
{
  const head = [[0, ZERO], [220, [-1, -5, -1]], [560, [-2, -14, -3]], [900, [-1.5, -13, -2.5]], [1250, [-1, -12, -2]],
    [1650, [0, 5, 2]], [1900, [0.5, 7, 2.5]], [2200, [0.5, 6, 2]], [2650, ZERO]];
  clips.look = { kind: 'oneShot', agreed: 'look', bakeFps: 8,
    bones: { head, neck: scaled(head, 0.5, 40), upperChest: scaled(head, 0.15, 120), spine: scaled(head, 0.05, 160) },
    gaze: [[0, [0, 0]], [120, [-16, 2]], [1250, [-14, 2], 'h'], [1450, [10, 0]], [2200, [8, 0], 'h'], [2550, [0, 0]]],
    expressions: { blink: [[0, 0], [130, 0], [200, 1], [310, 0], [1370, 0], [1440, 0.9], [1550, 0]] } };
}

// hairTuck (app name "wink"): left fingers tuck the fringe strand behind the left ear.
{
  const L = arm('left', [
    [0, 'rest'],
    [180, PRESS],
    [430, FRONT],
    [740, TUCKMID],
    [1090, { wrist: [0.165, 1.44, 0.11], elbow: [0.26, 1.18, 0.12], tip: [0.12, 1.53, 0.07] }],
    [1200, { wrist: [0.16, 1.45, 0.06], elbow: [0.26, 1.19, 0.1], tip: [0.105, 1.535, -0.02] }],
    [1600, { wrist: [0.165, 1.445, 0.055], elbow: [0.265, 1.185, 0.09], tip: [0.11, 1.53, -0.03] }, 'h'],
    [1960, TUCKMID],
    [2230, FRONT],
    [2440, INFRONT],
    [2580, SETTLE],
    [2700, 'rest'],
  ], { handLag: 50 });
  const head = [[0, ZERO], [180, [0, 1, 0]], [800, [1.5, 5, -5]], [1080, [2, 6, -7]], [1650, [2.5, 5, -6.5], 'h'], [2150, [1, 2, -2]], [2700, ZERO]];
  clips.hairTuck = { kind: 'oneShot', agreed: 'hair tuck', appName: 'wink', bakeFps: 8,
    bones: { ...L, head, neck: scaled(head, 0.4, 40), leftShoulder: [[0, ZERO], [800, [0, 0, 3]], [1650, [0, 0, 2.5]], [2300, [0, 0, 0.5]], [2700, ZERO]],
      spine: [[0, ZERO], [900, [0, 0, -1.5]], [1700, [0, 0, -1.2]], [2700, ZERO]] },
    fingers: { left: [[0, ZERO], [500, [-0.25, 0.1, -0.1]], [1080, [-0.15, 0.15, 0]], [1650, [-0.12, 0.15, 0]], [2420, [0.05, 0, 0]], [2700, ZERO]] },
    gaze: [[0, [0, 0]], [500, [6, -6]], [1650, [5, -5], 'h'], [2100, [0, 0]]],
    expressions: { happy: [[0, 0], [1080, 0.3], [1650, 0.3], [2400, 0]], blink: [[0, 0], [700, 0.25], [1650, 0.3], [2200, 0]] },
    idleWeight: { leftUpperArm: 0, head: 0.4, neck: 0.4 } };
}

// think: stateful. Knuckles under the chin, elbow down in front of the ribs; right arm keeps hanging.
{
  const chin = { wrist: [0.05, 1.36, 0.14], elbow: [0.17, 1.1, 0.13], tip: [0.01, 1.43, 0.12] };
  const chin2 = { wrist: [0.055, 1.355, 0.145], elbow: [0.175, 1.095, 0.13], tip: [0.015, 1.425, 0.125] };
  const enterL = arm('left', [
    [0, 'rest'],
    [160, PRESS],
    [470, FRONT],
    [820, { wrist: [0.055, 1.35, 0.15], elbow: [0.175, 1.09, 0.13], tip: [0.015, 1.42, 0.13] }],
    [1050, chin, 'h'],
  ], { handLag: 40 });
  const loopL = arm('left', [[0, chin], [1200, chin2], [2400, chin]]);
  const enterHead = [[0, ZERO], [200, [-2, 0, 0]], [850, [2, -5, 4]], [1050, [2, -5, 5], 'h']];
  const loopHead = [[0, [2, -5, 5]], [800, [1.5, -6, 6.5]], [1600, [2.5, -4.5, 5.5]], [2400, [2, -5, 5]]];
  const exitL = arm('left', [
    [0, chin],
    [180, { wrist: [0.07, 1.38, 0.17], elbow: [0.19, 1.12, 0.14], tip: [0.04, 1.45, 0.19] }],
    [520, FRONT],
    [760, INFRONT],
    [900, SETTLE],
    [1100, 'rest'],
  ], { handLag: 50 });
  const exitHead = [[0, [2, -5, 5]], [180, [-3, -1, 2]], [500, [-1, 2, 0]], [1000, ZERO]];
  const spineLean = [[0, ZERO], [900, [2, 0, 0]]];
  clips.think = { kind: 'stateful', agreed: 'think', bakeFps: 8,
    enter: { bones: { ...enterL, head: enterHead, neck: scaled(enterHead, 0.4, 40), spine: [[0, ZERO], [1050, [2, 0, 0]]] },
      fingers: { left: [[0, ZERO], [600, [0.2, -0.1, 0.2]], [1050, [0.35, -0.1, 0.3]]] },
      gaze: [[0, [0, 0]], [200, [10, 10]], [1050, [12, 11]]],
      expressions: { relaxed: [[0, 0], [1050, -0.15]], blink: [[0, 0], [700, 0.15], [1050, 0.15]] } },
    loop: { bones: { ...loopL, head: loopHead, neck: scaled(loopHead, 0.4), spine: [[0, [2, 0, 0]], [1200, [2.4, 0, 0]], [2400, [2, 0, 0]]] },
      fingers: { left: [[0, [0.35, -0.1, 0.3]], [600, [0.3, -0.1, 0.25]], [1200, [0.35, -0.1, 0.3]], [2400, [0.35, -0.1, 0.3]]] },
      gaze: [[0, [12, 11]], [700, [12, 11], 'h'], [760, [6, 9]], [1500, [6, 9], 'h'], [1560, [12, 11]], [2400, [12, 11]]],
      expressions: { relaxed: [[0, -0.15], [2400, -0.15]], blink: [[0, 0.15], [1200, 0.2], [2400, 0.15]] } },
    exit: { bones: { ...exitL, head: exitHead, neck: scaled(exitHead, 0.4), spine: [[0, [2, 0, 0]], [600, [0.5, 0, 0]], [1000, ZERO]] },
      fingers: { left: [[0, [0.35, -0.1, 0.3]], [300, [-0.2, 0.2, -0.1]], [800, [0.05, 0, 0]], [1000, ZERO]] },
      gaze: [[0, [12, 11]], [150, [0, 0]], [1000, [0, 0]]],
      expressions: { relaxed: [[0, -0.15], [400, 0], [1000, 0]], surprised: [[0, 0], [150, 0.35], [450, 0.2], [900, 0]],
        happy: [[0, 0], [350, 0.4], [1000, 0]], blink: [[0, 0.15], [120, 0], [1000, 0]] } },
    idleWeight: { leftUpperArm: 0, leftLowerArm: 0, leftHand: 0, head: 0.35, neck: 0.35 },
    spineHoldNote: 'spine stays leaned 2 deg forward through the loop' };
  clips.think.spineHoldNote = undefined;
}

// talk: stateful, bound to speech. Left hand offers palm-up toward the bubble side, then beat gestures.
{
  const offer = { wrist: [0.27, 1.1, 0.21], elbow: [0.25, 1.05, -0.0], tip: [0.3, 1.11, 0.37] };
  // beats, so the arm does not read frozen: the forearm dips and the wrist flicks the hand down on each
  // beat, and the second offer opens a little further out and higher
  const beat = { wrist: [0.27, 1.055, 0.215], elbow: [0.25, 1.035, 0.0], tip: [0.3, 1.025, 0.37] };
  const offer2 = { wrist: [0.3, 1.125, 0.19], elbow: [0.26, 1.055, -0.01], tip: [0.345, 1.15, 0.34] };
  const enterL = arm('left', [
    [0, 'rest'],
    [140, PRESS],
    [320, DROP],
    [500, { wrist: [0.25, 1.05, 0.15], elbow: [0.29, 1.06, -0.03] }],
    [660, offer, 'h'],
  ], { handLag: 40 });
  const loopL = arm('left', [[0, offer], [260, beat], [600, offer2], [860, beat], [1200, offer]]);
  const exitL = arm('left', [
    [0, offer],
    [240, { wrist: [0.25, 1.05, 0.13], elbow: [0.3, 1.07, -0.04] }],
    [440, DROP],
    [620, SETTLE],
    [750, 'rest'],
  ], { handLag: 50 });
  const H = [3, 6, -3];
  clips.talk = { kind: 'stateful', agreed: 'talk', bakeFps: 8,
    enter: { bones: { ...enterL, head: [[0, ZERO], [600, H]], neck: [[0, ZERO], [600, [1, 2, -1]]], upperChest: [[0, ZERO], [600, [0, 2, 0]]] },
      fingers: { left: [[0, ZERO], [600, [-0.3, 0.15, -0.15]]] },
      expressions: { happy: [[0, 0], [600, 0.2]], surprised: [[0, 0], [300, 0.15], [600, 0.1]] } },
    loop: { bones: { ...loopL,
      head: [[0, H], [260, [4.5, 6, -3]], [600, [3, 7, -3.5]], [860, [4.5, 6.5, -3]], [1200, H]],
      neck: [[0, [1, 2, -1]], [1200, [1, 2, -1]]], upperChest: [[0, [0, 2, 0]], [600, [0.5, 2.5, 0]], [1200, [0, 2, 0]]] },
      fingers: { left: [[0, [-0.3, 0.15, -0.15]], [600, [-0.25, 0.2, -0.1]], [1200, [-0.3, 0.15, -0.15]]] },
      expressions: {
        happy: [[0, 0.2], [1200, 0.2]], surprised: [[0, 0.1], [260, 0.2], [600, 0.1], [860, 0.18], [1200, 0.1]] },
      note: 'Body only: the mouth is the stateMachine.mouth layer, gated by speaking (MOTION_SPEC.md issue 6).' },
    exit: { bones: { ...exitL, head: [[0, H], [450, [1, 2, -1]], [750, ZERO]], neck: [[0, [1, 2, -1]], [750, ZERO]], upperChest: [[0, [0, 2, 0]], [750, ZERO]] },
      fingers: { left: [[0, [-0.3, 0.15, -0.15]], [560, [0.05, 0, 0]], [750, ZERO]] },
      expressions: { happy: [[0, 0.2], [750, 0]], surprised: [[0, 0.1], [400, 0]] } },
    idleWeight: { leftUpperArm: 0, leftLowerArm: 0, leftHand: 0, head: 0.5, neck: 0.5 } };
}

// wave: elbow leads up, forearm swings about the elbow, the hand trails each swing (follow-through).
{
  const up = (x, z = 0.12) => ({ wrist: [x, 1.4, z], elbow: [0.31, 1.13, 0.1], tip: [x + (x - 0.27) * 0.4, 1.56, z + 0.01] });
  const L = arm('left', [
    [0, 'rest'],
    [130, PRESS],
    // the hand comes up in front of the body, not out past the frame edge: the elbow lifts
    // out from the shoulder first, the forearm turns up through the inside
    [330, { wrist: [0.27, 1.05, 0.15], elbow: [0.33, 1.03, -0.01] }],
    [520, { wrist: [0.3, 1.2, 0.16], elbow: [0.32, 1.06, 0.02] }],
    [720, up(0.27)],
    // the inward swings stop short of the hair (0.22 and 0.23 put the palm over it); the drawing's forearm
    // leans in, so the whole arc sits 0.05 m (about 9 app px) further out to keep the hand off the side of the head
    [800, up(0.37)], [1000, up(0.305)], [1200, up(0.37)], [1400, up(0.31)], [1600, up(0.35)],
    [1800, up(0.31), 'h'],
    [2100, { wrist: [0.3, 1.18, 0.15], elbow: [0.32, 1.06, 0.01] }],
    [2450, SETTLE],
    [2650, 'rest'],
  ], { handLag: 60 });
  const head = [[0, ZERO], [380, [0, 3, -2]], [700, [-1, 5, -5]], [1800, [-1, 5, -4.5], 'h'], [2300, [0, 2, -1]], [2650, ZERO]];
  clips.wave = { kind: 'oneShot', agreed: 'wave', bakeFps: 10,
    bones: { ...L, head, neck: scaled(head, 0.4, 40),
      spine: [[0, ZERO], [600, [0, 0, 1.5]], [1800, [0, 0, 1.3]], [2650, ZERO]],
      leftShoulder: [[0, ZERO], [600, [0, 0, 4]], [1800, [0, 0, 4]], [2300, [0, 0, 1]], [2650, ZERO]] },
    fingers: { left: [[0, ZERO], [400, [-0.35, 0.2, -0.2]], [600, [-0.4, 0.3, -0.25]], [1800, [-0.4, 0.3, -0.25]], [2400, [0.05, 0, 0]], [2650, ZERO]] },
    gaze: [[0, [0, 0]], [200, [4, 2]], [2200, [4, 2], 'h'], [2600, [0, 0]]],
    expressions: { happy: [[0, 0], [500, 0.6], [1800, 0.6], [2650, 0]], blink: [[0, 0], [600, 0.2], [1800, 0.2], [2650, 0]] },
    idleWeight: { leftUpperArm: 0, leftLowerArm: 0, leftHand: 0, head: 0.4, neck: 0.4 } };
}

// happy: anticipation dip, small fist pump at the chest with the left hand, two knee bounces.
{
  const d1 = dip(0.018), d2 = dip(0.01);
  const pump = { wrist: [0.17, 1.2, 0.17], elbow: [0.25, 1.02, 0.03], tip: [0.13, 1.28, 0.22] };
  const pump2 = { wrist: [0.175, 1.235, 0.17], elbow: [0.25, 1.04, 0.03], tip: [0.135, 1.31, 0.215] };
  const L = arm('left', [
    [0, 'rest'],
    [180, PRESS],
    [440, FRONT],
    [700, pump2], [850, pump], [1000, pump2], [1250, pump, 'h'],
    [1620, FRONT],
    [1850, INFRONT],
    [2000, SETTLE],
    [2200, 'rest'],
  ], { handLag: 40 });
  const d3 = dip(0.004);
  const legs = (k) => [[0, ZERO], [180, d1[k]], [420, ZERO], [620, d2[k]], [900, ZERO], [1150, d3[k]], [1500, ZERO], [2200, ZERO]];
  const head = [[0, ZERO], [180, [3, 0, 0]], [420, [-3, 4, -5]], [620, [-1, 4, -6]], [900, [-3, 4, -5]], [1150, [-1, 3, -5]], [1700, [0, 1, -2]], [2200, ZERO]];
  clips.happy = { kind: 'oneShot', agreed: 'happy', bakeFps: 10,
    bones: { ...L, head, neck: scaled(head, 0.4, 30),
      leftUpperLeg: legs('lUp'), rightUpperLeg: legs('rUp'), leftLowerLeg: legs('lLo'), rightLowerLeg: legs('rLo'), leftFoot: legs('lFt'), rightFoot: legs('rFt'),
      chest: [[0, ZERO], [180, [2, 0, 0]], [420, [-3, 0, 0]], [900, [-2.5, 0, 0]], [1500, [-1, 0, 0]], [2200, ZERO]],
      rightUpperArm: [[0, ZERO], [260, [0, 4, 0]], [520, [0, -3, 0]], [800, [0, 3, 0]], [1100, [0, -1.5, 0]], [1500, [0, 1, 0]], [2200, ZERO]],
      rightLowerArm: [[0, ZERO], [320, [0, 6, 0]], [580, [0, -2, 0]], [860, [0, 4, 0]], [1500, [0, 0.5, 0]], [2200, ZERO]] },
    hipsOffset: legs('hipsOffset'),
    fingers: { left: [[0, ZERO], [420, [0.45, -0.1, 0.5]], [1150, [0.45, -0.1, 0.5]], [1800, [0.1, 0, 0]], [2200, ZERO]] },
    expressions: { happy: [[0, 0], [400, 0.9], [1300, 0.85], [2200, 0]], relaxed: [[0, 0], [400, -0.25], [1500, -0.2], [2200, 0]],
      blink: [[0, 0], [400, 0.35], [1300, 0.3], [2200, 0]], aa: [[0, 0], [420, 0.15], [900, 0.1], [1300, 0]] },
    idleWeight: { leftUpperArm: 0, leftLowerArm: 0, leftHand: 0, head: 0.4 } };
}

// drag: stateful; lifted by the window: the legs dangle and swing like pendulums (airborne), the left arm lets
// go of the hip and hangs (a lifted body hangs; a hand at the chest does not read as lifted),
// swinging a little with the legs. Land: the legs reach for the ground, the knees absorb, a small second bob settles.
{
  const clav = { wrist: [0.25, 0.83, 0.03], elbow: [0.235, 1.035, -0.025], tip: [0.245, 0.665, 0.065] };
  const clav2 = { wrist: [0.265, 0.835, 0.045], elbow: [0.24, 1.035, -0.02], tip: [0.27, 0.67, 0.08] };
  const enterL = arm('left', [[0, 'rest'], [90, LIFT],
    [300, { wrist: [0.26, 0.92, 0.05], elbow: [0.29, 1.07, -0.04] }], [440, clav, 'h']], { handLag: 40 });
  const loopL = arm('left', [[0, clav], [800, clav2], [1600, clav]]);
  const landL = arm('left', [[0, clav], [260, { wrist: [0.25, 0.9, 0.06], elbow: [0.3, 1.06, -0.03] }],
    [560, SETTLE], [800, 'rest']], { handLag: 40 });
  // Hanging legs (deltas from rest): knees soft, toes pointing down a little.
  const hang = { lUp: [-2, 0, 0], lLo: [16, 0, 0], lFt: [14, 0, 0], rUp: [-4, 0, 0], rLo: [22, 0, 0], rFt: [16, 0, 0] };
  // Pendulum: period 1600 ms, thighs swing fore-aft (x) and a little sideways (z); the shin follows 200 ms
  // later with more swing (follow-through) and the foot 300 ms later; the legs swing nearly together (0.6 rad
  // apart): half a cycle apart, the fore-aft swing projects sideways at the camera's 14 deg and the feet cross.
  const P = 1600, KEYS = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600];
  const pend = (base, amp, lagMs, phase) => KEYS.map((t) => [t, base.map((x, i) => r1(x + amp[i] * Math.sin(2 * Math.PI * (t - lagMs) / P + phase)))]);
  const swing = {
    leftUpperLeg: pend(hang.lUp, [10, 0, 2], 0, 0), leftLowerLeg: pend(hang.lLo, [12, 0, 0], 200, 0), leftFoot: pend(hang.lFt, [8, 0, 0], 300, 0),
    rightUpperLeg: pend(hang.rUp, [9, 0, -1.5], 0, 0.6), rightLowerLeg: pend(hang.rLo, [12, 0, 0], 200, 0.6), rightFoot: pend(hang.rFt, [8, 0, 0], 300, 0.6),
  };
  const at0 = (b) => swing[b][0][1];
  const D = dip(0.025), D2 = dip(0.004), D3 = dip(0.009);
  const legKeys = (b, k) => [[0, at0(b)], [110, hang[k].map((x) => r1(x * 0.3))], [160, ZERO, 'h'], [300, D[k]], [480, D2[k]], [620, D3[k]], [800, ZERO]];
  clips.drag = { kind: 'stateful', agreed: 'drag', airborne: true, bakeFps: 10,
    enter: { bones: { ...enterL,
      rightUpperArm: [[0, ZERO], [200, [0, 7, 0]], [420, [0, 6, 0]]], rightLowerArm: [[0, ZERO], [220, [0, 9, 0]], [420, [0, 8, 0]]],
      // lifted: the thighs trail back and the knees fold as the body goes up, then swing into the pendulum
      leftUpperLeg: [[0, ZERO], [180, [3, 0, 0]], [440, at0('leftUpperLeg')]], leftLowerLeg: [[0, ZERO], [180, [22, 0, 0]], [440, at0('leftLowerLeg')]], leftFoot: [[0, ZERO], [240, [16, 0, 0]], [440, at0('leftFoot')]],
      rightUpperLeg: [[0, ZERO], [180, [2, 0, 0]], [440, at0('rightUpperLeg')]], rightLowerLeg: [[0, ZERO], [200, [26, 0, 0]], [440, at0('rightLowerLeg')]], rightFoot: [[0, ZERO], [260, [18, 0, 0]], [440, at0('rightFoot')]],
      head: [[0, ZERO], [150, [-6, 3, 1]], [440, [-4, 5, 3]]], neck: [[0, ZERO], [440, [-2, 2, 1]]], chest: [[0, ZERO], [150, [-3, 0, 0]], [440, [-2, 0, 0]]] },
      hipsOffset: [[0, ZERO], [200, [0, 0.03, 0]], [440, [0, 0.04, 0]]],
      fingers: { left: [[0, ZERO], [260, [-0.4, 0.4, -0.2]], [440, [-0.35, 0.35, -0.2]]], right: [[0, ZERO], [300, [-0.15, 0.2, 0]], [440, [-0.15, 0.2, 0]]] },
      gaze: [[0, [0, 0]], [120, [0, 6]], [440, [3, 4]]],
      expressions: { surprised: [[0, 0], [150, 0.8], [440, 0.6]], oh: [[0, 0], [150, 0.4], [440, 0.25]], relaxed: [[0, 0], [150, -0.25], [440, -0.25]] } },
    loop: { bones: { ...loopL, ...swing,
      rightUpperArm: [[0, [0, 6, 0]], [800, [0, 7, 0]], [1600, [0, 6, 0]]], rightLowerArm: [[0, [0, 8, 0]], [800, [0, 9.5, 0]], [1600, [0, 8, 0]]],
      head: [[0, [-4, 5, 3]], [800, [-3, 6, 4]], [1600, [-4, 5, 3]]], neck: [[0, [-2, 2, 1]], [1600, [-2, 2, 1]]], chest: [[0, [-2, 0, 0]], [1600, [-2, 0, 0]]] },
      hipsOffset: [[0, [0, 0.04, 0]], [800, [0, 0.043, 0]], [1600, [0, 0.04, 0]]],
      fingers: { left: [[0, [-0.35, 0.35, -0.2]], [1600, [-0.35, 0.35, -0.2]]], right: [[0, [-0.15, 0.2, 0]], [1600, [-0.15, 0.2, 0]]] },
      gaze: [[0, [3, 4]], [900, [3, 4], 'h'], [950, [-3, -6]], [1500, [-3, -6], 'h'], [1600, [3, 4]]],
      expressions: { surprised: [[0, 0.6], [800, 0.5], [1600, 0.6]], oh: [[0, 0.25], [1600, 0.25]], relaxed: [[0, -0.25], [1600, -0.25]] } },
    exit: { name: 'land', bones: { ...landL,
      rightUpperArm: [[0, [0, 6, 0]], [250, [0, 3, 0]], [500, [0, -0.7, 0]], [800, ZERO]], rightLowerArm: [[0, [0, 8, 0]], [300, [0, 4, 0]], [550, [0, -0.5, 0]], [800, ZERO]],
      leftUpperLeg: legKeys('leftUpperLeg', 'lUp'), leftLowerLeg: legKeys('leftLowerLeg', 'lLo'), leftFoot: legKeys('leftFoot', 'lFt'),
      rightUpperLeg: legKeys('rightUpperLeg', 'rUp'), rightLowerLeg: legKeys('rightLowerLeg', 'rLo'), rightFoot: legKeys('rightFoot', 'rFt'),
      head: [[0, [-4, 5, 3]], [300, [3, 2, 1]], [550, [-1, 0, 0]], [800, ZERO]], neck: [[0, [-2, 2, 1]], [800, ZERO]], chest: [[0, [-2, 0, 0]], [300, [2, 0, 0]], [800, ZERO]] },
      hipsOffset: [[0, [0, 0.04, 0]], [110, [0, 0.012, 0]], [160, [0, 0.0, 0], 'h'], [300, D.hipsOffset], [480, D2.hipsOffset], [620, D3.hipsOffset], [800, ZERO]],
      fingers: { left: [[0, [-0.35, 0.35, -0.2]], [560, [0.05, 0, 0]], [800, ZERO]], right: [[0, [-0.15, 0.2, 0]], [500, ZERO], [800, ZERO]] },
      gaze: [[0, [3, 4]], [200, [0, -4]], [800, [0, 0]]],
      expressions: { surprised: [[0, 0.6], [300, 0.1], [800, 0]], oh: [[0, 0.25], [250, 0], [800, 0]], relaxed: [[0, -0.25], [300, 0], [800, 0]],
        happy: [[0, 0], [450, 0.35], [800, 0]], blink: [[0, 0], [300, 0], [360, 0.9], [470, 0], [800, 0]] },
      groundContactAt: 160 },
    // the weight sway is one coupled layer (pelvis + legs): mute it as a whole while airborne
    idleWeight: { leftUpperArm: 0, leftLowerArm: 0, leftHand: 0, hips: 0, hipsOffset: 0, rightUpperLeg: 0, leftUpperLeg: 0, rightLowerLeg: 0, leftLowerLeg: 0, rightFoot: 0, leftFoot: 0 } };
}

// sleep: stateful; dozing off standing: the hand slides off the hip and hangs, head sinks with slow breaths.
{
  const hangL = { wrist: [0.235, 0.81, 0.035], elbow: [0.225, 1.03, -0.02], tip: [0.225, 0.645, 0.07] };
  const hangL2 = { wrist: [0.235, 0.805, 0.04], elbow: [0.225, 1.03, -0.015], tip: [0.225, 0.64, 0.075] };
  const enterL = arm('left', [[0, 'rest'], [900, 'rest', 'h'],
    [1300, { wrist: [0.22, 0.93, 0.05], elbow: [0.3, 1.08, -0.05], tip: [0.215, 0.765, 0.075] }], [1700, { wrist: [0.235, 0.82, 0.03], elbow: [0.235, 1.03, -0.03] }], [2100, hangL, 'h']], { handLag: 60 });
  const loopL = arm('left', [[0, hangL], [2600, hangL2], [5200, hangL]]);
  const exitL = arm('left', [[0, hangL], [500, hangL2, 'h'],
    [900, { wrist: [0.22, 0.93, 0.06], elbow: [0.31, 1.08, -0.05] }],
    [1250, SETTLE], [1500, 'rest']], { handLag: 50 });
  const HS = [8, -3, 6], NS = [10, -1, 2];
  // Relaxed stance: the knees soften and the hips settle 8 mm, rising a little with each slow breath.
  const S8 = dip(0.008), S6 = dip(0.005), S3 = dip(0.003);
  const sleepLegs = { lUp: 'leftUpperLeg', lLo: 'leftLowerLeg', lFt: 'leftFoot', rUp: 'rightUpperLeg', rLo: 'rightLowerLeg', rFt: 'rightFoot' };
  const legs = (keys) => Object.fromEntries(Object.entries(sleepLegs).map(([k, b]) => [b, keys.map(([t, d]) => [t, d === 0 ? ZERO : d[k]])]));
  const hips = (keys) => keys.map(([t, d]) => [t, d === 0 ? ZERO : d.hipsOffset]);
  const enterLegs = [[0, 0], [1000, S3], [2100, S8]], loopLegs = [[0, S8], [2100, S6], [5200, S8]], exitLegs = [[0, S8], [300, S3], [1500, 0]];
  clips.sleep = { kind: 'stateful', agreed: 'sleep', bakeFps: 6,
    enter: { bones: { ...enterL,
      head: [[0, ZERO], [500, [3, 0, 1]], [800, [1, 0, 0.5]], [1500, [6, -2, 4]], [2100, HS]],
      neck: [[0, ZERO], [600, [3, 0, 0.5]], [900, [2, 0, 0]], [1600, [8, -1, 1.5]], [2100, NS]],
      upperChest: [[0, ZERO], [2100, [3, 0, 0]]], leftShoulder: [[0, ZERO], [1400, [0, 0, -1]], [2100, [0, 0, -2]]], rightShoulder: [[0, ZERO], [2100, [0, 0, 2]]], ...legs(enterLegs) },
      hipsOffset: hips(enterLegs),
      fingers: { left: [[0, ZERO], [1200, ZERO], [2100, [-0.2, -0.05, -0.1]]] },
      gaze: [[0, [0, 0]], [400, [0, -8]], [2100, [0, -10]]],
      expressions: { blink: [[0, 0], [400, 0.4], [700, 0.2], [1100, 0.6], [1400, 0.45], [2100, 1]], relaxed: [[0, 0], [2100, 0.3]], aa: [[0, 0], [1600, 0], [2100, 0.06]] } },
    loop: { bones: { ...loopL,
      head: [[0, HS], [1900, [9.4, -3, 6.4]], [2600, [10.6, -3.6, 7.1]], [3300, [9.3, -2.8, 6.3]], [5200, HS]],
      neck: [[0, NS], [2100, [11, -1, 2]], [5200, NS]],
      upperChest: [[0, [3, 0, 0]], [2100, [0.4, 0, 0]], [2500, [0.6, 0, 0]], [5200, [3, 0, 0]]],
      chest: [[0, ZERO], [2100, [-2.3, 0, 0]], [2500, [-2.0, 0, 0]], [5200, ZERO]],
      leftShoulder: [[0, [0, 0, -2]], [2000, [0, 0, 0]], [5200, [0, 0, -2]]], rightShoulder: [[0, [0, 0, 2]], [2000, [0, 0, 0]], [5200, [0, 0, 2]]], ...legs(loopLegs) },
      hipsOffset: hips(loopLegs),
      fingers: { left: [[0, [-0.2, -0.05, -0.1]], [5200, [-0.2, -0.05, -0.1]]] },
      gaze: [[0, [0, -10]], [5200, [0, -10]]],
      expressions: { blink: [[0, 1], [5200, 1]], relaxed: [[0, 0.3], [5200, 0.3]], aa: [[0, 0.06], [2000, 0.1], [5200, 0.06]] },
      note: 'Breath slows to 5.2 s and deepens; the idle breath layer is muted (idleWeight) so the two do not stack.' },
    exit: { name: 'wake', bones: { ...exitL,
      head: [[0, HS], [220, [-3, 1, 1]], [450, [0, 0, 0.5]], [900, [-1, 2, -1]], [1500, ZERO]],
      neck: [[0, NS], [250, [-1, 0, 0.5]], [600, [1, 0, 0]], [1500, ZERO]],
      upperChest: [[0, [3, 0, 0]], [300, [-2.5, 0, 0]], [900, [-1, 0, 0]], [1500, ZERO]],
      chest: [[0, ZERO], [300, [-2, 0, 0]], [800, [-0.5, 0, 0]], [1500, ZERO]],
      leftShoulder: [[0, [0, 0, -2]], [300, [0, 0, 2]], [1500, ZERO]], rightShoulder: [[0, [0, 0, 2]], [300, [0, 0, -2]], [1500, ZERO]], ...legs(exitLegs) },
      hipsOffset: hips(exitLegs),
      fingers: { left: [[0, [-0.2, -0.05, -0.1]], [800, [-0.1, 0.05, 0]], [1500, ZERO]] },
      gaze: [[0, [0, -10]], [250, [0, 3]], [700, [-5, 0]], [1100, [0, 0]]],
      expressions: { blink: [[0, 1], [200, 0.3], [330, 0], [430, 0], [490, 0.95], [620, 0], [1500, 0]], surprised: [[0, 0], [220, 0.35], [700, 0]],
        relaxed: [[0, 0.3], [1500, 0]], aa: [[0, 0.06], [200, 0], [1500, 0]] } },
    idleWeight: { chest: 0, upperChest: 0, leftShoulder: 0, rightShoulder: 0, leftUpperArm: 0, head: 0.2, neck: 0.2 },
    eyelidOwner: true };
  // While the head sinks the hand is still on the hip: hold the contact against the moving chest.
  const E = clips.sleep.enter.bones;
  const torsoAt = (t) => Object.fromEntries(Object.entries(E).filter(([b]) => !/^left(UpperArm|LowerArm|Hand)$/.test(b)).map(([b, tr]) => [b, sampleTrack(tr, t)]));
  for (const b of ['leftUpperArm', 'leftLowerArm', 'leftHand']) {
    const tr = E[b];
    tr[1] = [tr[1][0], hipHold(torsoAt(tr[1][0]))[b], 'h'];
    tr.splice(1, 0, [450, hipHold(torsoAt(450))[b]]);
  }
}

// Proposed additions (not in the agreed list): notice on hover, nod on click/reveal.
{
  const head = [[0, ZERO], [150, [-1.5, 2, 0]], [450, [-1, 7, -4]], [1100, [-0.5, 6, -4.5], 'h'], [1600, ZERO]];
  clips.notice = { kind: 'oneShot', proposed: true, bakeFps: 8,
    bones: { head, neck: scaled(head, 0.4, 40), upperChest: scaled(head, 0.08, 100) },
    gaze: [[0, [0, 0]], [60, [10, 3]], [1100, [8, 3], 'h'], [1500, [0, 0]]],
    expressions: { surprised: [[0, 0], [150, 0.25], [500, 0.05], [1600, 0]], happy: [[0, 0], [400, 0.45], [1100, 0.4], [1600, 0]] } };
  const nod = [[0, ZERO], [120, [-2, 0, 0]], [300, [7, 1, -1]], [480, [-1, 0, 0]], [650, [2, 0, 0]], [900, ZERO]];
  clips.nod = { kind: 'oneShot', proposed: true, bakeFps: 10,
    bones: { head: nod, neck: scaled(nod, 0.5, 40), upperChest: scaled(nod, 0.06, 80) },
    expressions: { happy: [[0, 0], [300, 0.35], [900, 0]] } };
}

// ---------------------------------------------------------------- behaviour state machine
// Source references: found by text in the app's files at generation time (read-only), so the cited lines
// are current; check_spec.mjs re-reads the files and fails on a stale line.
const ROOT = join(HERE, '../../../../..');
const REF_TEXT = {
  showNext: ['src/pet/Pet.svelte', 'function showNext'], reveal: ['src/pet/Pet.svelte', 'function reveal'], nextNow: ['src/pet/Pet.svelte', 'function nextNow'],
  goSleep: ['src/pet/Pet.svelte', 'function goSleep'], wake: ['src/pet/Pet.svelte', 'function wake'], loop: ['src/pet/Pet.svelte', 'async function loop'],
  quiet: ['src/pet/Pet.svelte', 'inQuietHours()'], idleSecs: ['src/pet/Pet.svelte', 'sys.idleSecs >'], dragMove: ['src/pet/Pet.svelte', 'function onDragMove'],
  dragFallback: ['src/pet/Pet.svelte', '}, 1200);'], moved: ['src/pet/Pet.svelte', 'win.onMoved('], spriteUp: ['src/pet/Pet.svelte', 'function onSpriteUp'],
  resume: ['src/pet/Pet.svelte', 'function resume'], restore: ['src/pet/Pet.svelte', 'await restorePlacement()'], known: ['src/pet/Pet.svelte', 'onknown='],
  onreveal: ['src/pet/Pet.svelte', 'onreveal='], onhover: ['src/pet/Pet.svelte', 'onhover='], enter: ['src/pet/Pet.svelte', 'onpointerenter='],
  menu: ['src/pet/Pet.svelte', 'menuOpen = !menuOpen'], hide: ['src/pet/Pet.svelte', 'win.hide()'], show: ['src/pet/Pet.svelte', 'win.show()'],
  idleTicks: ['src/lib/rig/rig-player.js', "this.events.push([t, 'idleTick'])"], menuNext: ['src/pet/Pet.svelte', 'nextNow(); }}>'], trayNext: ['src/pet/Pet.svelte', "payload === 'next'"],
  speak: ['src/lib/speech/index.ts', 'speechSynthesis.speak('], play: ['src/lib/speech/index.ts', 'await audio.play()'], cancel: ['src/lib/speech/index.ts', 'speechSynthesis.cancel()'],
};
const REFS = Object.fromEntries(Object.entries(REF_TEXT).map(([k, [file, text]]) => {
  const lines = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.includes(text));
  if (i < 0) throw new Error(`source reference ${k}: "${text}" not found in ${file}`);
  return [k, { file, line: i + 1, text }];
}));
const at = (...keys) => keys.map((k) => REFS[k]);
const L = (k) => `${REFS[k].file.split('/').pop()}:${REFS[k].line}`;

const stateMachine = {
  note: 'Binds clips to the real events in src/pet/Pet.svelte. One body clip plays at a time; blink, saccade, the click nod and the mouth are layers on top. lib/behaviour.mjs is the reference implementation of these rules; the checker runs it on scenarios that reproduce Pet.svelte call order. Source lines in `at` are found by text at generation time and re-verified by the checker.',
  events: {
    wordShownRevealed: { source: `Pet.svelte showNext() with revealed = true (${L('showNext')})`, at: at('showNext'), clip: 'talk', priority: 50, hold: 'whileSpeaking', minMs: 1600, maxMs: 6000,
      note: 'Talk loops while speech plays (speakStart..speakEnd); without speech, one loop then exit (min 1.6 s). The body offers the gesture; the mouth moves only while speaking.' },
    wordShownGuess: { source: `Pet.svelte showNext() with revealed = false (${L('showNext')})`, at: at('showNext'), clip: 'think', priority: 50, hold: 'untilEvent:reveal', maxMs: 8000 },
    reveal: { source: `NEW: emit from reveal() (${L('reveal')}), which plays nothing today; reached by the 2600 ms timer in showNext() and by Bubble onreveal (${L('onreveal')})`, at: at('reveal', 'onreveal'), exits: 'think', then: 'nod', priority: 55, locks: true },
    speakStart: { source: `NEW: speech start signal with a token per speak() call: utterance.onstart (system, after speechSynthesis.speak at ${L('speak')}) or audio playing (http/pack, after audio.play() at ${L('play')})`, at: at('speak', 'play'), clip: 'talk', priority: 50, hold: 'whileSpeaking', token: true },
    speakEnd: { source: `NEW: utterance.onend / onerror or audio ended / error / pause-on-replace in src/lib/speech/index.ts, carrying the token of its speak() call. speak() cancels the previous utterance first (${L('cancel')}); its late onerror carries the old token and is ignored. Not the speak() promise: it resolves when speech starts.`, at: at('cancel'), exits: 'talk', token: true },
    known: { source: `Bubble onknown (${L('known')})`, at: at('known'), clip: 'happy', priority: 70, locks: true,
      note: 'nextNow() shows the next word after SWAP_MS (1500 ms); its talk queues until happy ends.' },
    hoverEnter: { source: `sprite onpointerenter (${L('enter')})`, at: at('enter'), clip: 'notice', priority: 30, cooldownMs: 8000 },
    hoverBubble: { source: `Bubble onhover(true) (${L('onhover')})`, at: at('onhover'), gazeTarget: 'bubble', priority: 0, note: 'Gaze only: eyes and 30 % head toward the bubble; no clip.' },
    click: { source: `sprite onpointerup without drag (onSpriteUp -> resume, ${L('spriteUp')}, ${L('resume')})`, at: at('spriteUp', 'resume'), overlay: 'nod', cooldownMs: 600,
      note: 'The acknowledgement is an additive head/neck nod layer that starts at once over whatever plays (MOTION_SPEC.md issue 7); resume() -> nextNow() may show a word in the same tick and that talk plays at once.' },
    menuOpen: { source: `contextmenu toggles menuOpen (${L('menu')})`, at: at('menu'), gazeTarget: 'menu', priority: 0, sets: { menuOpen: true }, suppressFidgets: true },
    menuClose: { source: 'menuOpen becomes false (menu item, blur, Escape)', sets: { menuOpen: false } },
    dragStart: { source: `onDragMove past 4 px (${L('dragMove')})`, at: at('dragMove'), clip: 'drag', priority: 100, hold: 'untilEvent:dragEnd', interruptExitMs: 120 },
    dragEnd: { source: `win.onMoved quiet for 250 ms (${L('moved')}), or the 1200 ms fallback (${L('dragFallback')})`, at: at('moved', 'dragFallback'), exits: 'drag' },
    longIdle: { source: `loop(): sys.idleSecs > idlePauseMin * 60 (${L('idleSecs')}) -> goSleep() (${L('goSleep')})`, at: at('idleSecs', 'goSleep'), clip: 'sleep', priority: 90, hold: 'untilEvent:userBack',
      note: 'Sleep is a state: while sleeping is set, the scheduler requests sleep again whenever nothing plays (after a drag, after the window is shown again). goSleep() returns early when already sleeping, so the app never re-sends this event (CHECK-r2 issues 1-2).' },
    quietHours: { source: `loop(): inQuietHours() or progress.pausedUntil > now (${L('quiet')})`, at: at('quiet'), clip: 'sleep', priority: 90, hold: 'untilEvent:userBack' },
    userBack: { source: `the rig emits userBack whenever sleeping goes true -> false: wake() (${L('wake')}), resume() by click (${L('resume')}), and nextNow() (${L('nextNow')})`, at: at('wake', 'resume', 'nextNow'), exits: 'sleep', then: 'wave', locks: true,
      note: 'loop() calls wake() then advance() in the same tick; the word talk queues until wake and wave end.' },
    nextNow: { source: `nextNow() sets sleeping = false directly (${L('nextNow')}); called from the menu item (${L('menuNext')}) and the tray (${L('trayNext')})`, at: at('nextNow', 'menuNext', 'trayNext'), clearsSleep: true,
      note: 'While asleep this is a userBack (wake, then wave); otherwise nothing (MOTION_SPEC.md issue 3).' },
    fullscreenHide: { source: `busy && hideOnFullscreen -> win.hide() (${L('hide')})`, at: at('hide'), action: 'stopAll', note: 'Hidden: cancel every clip and timer, reset to rest; the draw loop stops. The sleeping state is kept.' },
    fullscreenShow: { source: `visible again -> win.show() (${L('show')}); NEW: remember hiddenSince`, at: at('show'), clip: 'wave', priority: 40, ifHiddenForMs: 300000, locks: true, resumeIfSleeping: true,
      note: 'If she was asleep when hidden she goes back to sleep, no wave (MOTION_SPEC.md issue 2).' },
    appStart: { source: `NEW: onMount after restorePlacement() (${L('restore')})`, at: at('restore'), clip: 'wave', priority: 40, locks: true,
      note: 'scheduleTick(1500) shows the first word at 1.5 s, mid-wave; that talk queues until the wave ends.' },
    idleTick: { source: `idle ticks pre-rolled by the rig timeline (${L('idleTicks')}): every 25-45 s while nothing plays (idle clips are rare events)`, at: at('idleTicks'), priority: 10, intervalMs: [25000, 45000],
      pick: [['look', 0.4], ['hairTuck', 0.25], ['breathe', 0.35]], noRepeat: true, seed: 20261105,
      cooldownMs: { hairTuck: 45000, breathe: 20000, look: 8000 },
      note: 'Weighted pick with a seeded RNG (lib/behaviour.mjs mulberry32), never the last pick, never a clip on cooldown, nothing while the menu is open or she sleeps (MOTION_SPEC.md issues 5, 9). Blink is not picked here: it is procedural (idle.events.blink).' },
  },
  mouth: { gate: 'speaking', releaseMs: 150, periodMs: 1200,
    note: 'Fallback viseme pattern, a layer of its own: weight = pattern x gate, gate 1 while speaking (speakStart..speakEnd of the current token), fading to 0 over releaseMs after. Nothing moves the mouth without sound (lib/behaviour.mjs mouthAt). Real speech boundaries or audio level replace the pattern when available.',
    tracks: {
      aa: [[0, 0], [90, 0.55], [200, 0.1], [600, 0], [700, 0.45], [800, 0.1], [1200, 0]],
      ih: [[0, 0], [200, 0], [300, 0.35], [400, 0], [1200, 0]],
      ou: [[0, 0], [400, 0], [520, 0.45], [600, 0.1], [900, 0], [1000, 0.3], [1100, 0], [1200, 0]],
      ee: [[0, 0], [800, 0], [900, 0.35], [1000, 0], [1200, 0]] } },
  interrupt: {
    rule: 'A request with higher priority than the playing clip preempts it, unless a lock holds. A request that cannot play queues if its priority >= queue.minPriority, else it is dropped.',
    lock: { breakPriority: 90, note: 'A locking event (click, reveal, known, userBack, appStart, fullscreenShow) holds its clip and its then-chain against every request below breakPriority. Only drag and sleep break it.' },
    queue: { size: 1, newestWins: true, expiryMs: 4500, minPriority: 40,
      note: 'Expiry covers the longest one-shot (breathe 3100 ms) and the longest locked chain (sleep exit 1500 + wave 2650 = 4150 ms).' },
    exit: { boundaryWaitMs: 400, blendMs: 200, note: 'On release a loop finishes its cycle if the boundary is within 400 ms, else it blends into the exit at once over 200 ms.' },
    preemptBlend: 'Crossfade in pose space from the current sampled pose into the new clip over interruptExitMs (default 250 ms, ease in-out).',
    statefulExit: 'A stateful clip ends by playing its exit section, never by snapping. maxMs forces the exit if the hold event never comes.',
  },
  priorities: { drag: 100, sleep: 90, happy: 70, reveal: 55, talk: 50, think: 50, wave: 40, notice: 30, idleTick: 10, clickNod: 'overlay' },
};

// ---------------------------------------------------------------- spec without the derived 2D and frame data
const spec = {
  $schema: 'motion-spec v2 (this folder: MOTION_SPEC.md)',
  convention: {
    rig: 'VRM 1.0 normalized humanoid bones (three-vrm getNormalizedBoneNode). VRM 0.x models: apply VRMUtils.rotateVRM0, then negate the X and Z of every rotation and of hipsOffset, because their normalized bones keep the model frame that faces -Z (three-vrm createVRMAnimationClip does the same). Verified by rendering Sendagaya_Shibu in spec poses (artifacts/vrm_poses.png). Gaze sign on VRM 0.x is not verified.',
    axes: '+Y up, +Z the way she faces, +X her left. Camera on +Z looking at -Z, turned camera.yawDeg around Y (orthographic).',
    euler: 'degrees, order XYZ as three.js Euler (matrix = Rx*Ry*Rz), in the normalized local space, relative to the T-pose (identity). lowerArm is a hinge: only its Y channel moves (X and Z stay 0 +/- 5). That holds because the parent X axis of the forearm is the humerus. upperArm.x is NOT humeral rotation: Rx is the outermost turn about the parent (shoulder) X axis, which is the humerus only in the T-pose, so on a lowered arm it swings the arm. Humeral and femoral rotation are measured by swing-twist decomposition against the limb hanging straight down (check_spec twist rule, lib/limits.mjs TWIST). Forearm pronation and supination are hand.x.',
    composition: 'final local euler = rest + sum(idle layers * idleWeight(t)) + action delta, per channel. idleWeight ramps over idle.rampMs at rest ends (lib/compose.mjs).',
    signs: { headX: '+ chin down', headY: '+ turn to her left', headZ: '+ tilt to her right shoulder', leftUpperArmZ: '- lowers the arm', rightUpperArmZ: '+ lowers the arm', leftLowerArmY: '- bends the elbow (forearm forward)', rightLowerArmY: '+ bends the elbow', upperLegX: '- swings the thigh forward', footY: '- turns the right toes out, + the left toes out', upperLegZ: '+ moves the right foot toward her left (adduction of the right leg)', lowerLegX: '+ bends the knee', footX: '+ points the toes' },
    curves: 'Each track is a list of keys [tMs, value, flags?]; monotone cubic Hermite (Fritsch-Carlson) per channel; tangent 0 at the first and last key and at keys flagged "h". Before the first key the first value holds; after the last, the last value.',
    fingers: '[curl, spread, thumbCurl] deltas added to rest.fingers; a rig maps curl c to each finger joint X = c * [55, 75, 45] deg (proximal, intermediate, distal), spread s to proximal Z = s * [-8,-3,3,8] across index..little, thumb t to thumb joints = t * [20, 35, 40].',
    gaze: '[yawDeg, pitchDeg] relative to straight ahead of the head; +yaw her left, +pitch up. VRM: lookAt.yaw/pitch (or a lookAt target placed on that ray). 2D: shift the iris layer.',
    expressions: 'VRM 1.0 preset names (happy, relaxed, surprised, aa, ih, ou, ee, oh, blink). Values are deltas added to rest.expressions, clamped to 0..1.',
    hipsOffset: 'metres, added to the hips position (dip, lift).',
    twoD: 'Layered 2D rig (lib/layer2d.mjs): run FK, project with camera.yawDeg. Each limb drawing is pinned at its projected joint, rotated to the projected bone angle, and stretched along the bone by ratio / variant.nominal, where ratio = projected length / true length; the variant is picked from twoD.parts[p].variants by ratio and depth (toward or away from the camera). Head, torso and pelvis pick a turn view by camera-relative yaw and pitch and shift their face parts by parallax between views. Draw order: sort parts by camera depth of their midpoints every frame.',
  },
  camera: { yawDeg: 14 },
  skeleton: { note: 'Proportions used by the checker and preview (1.60 m). A real rig keeps the angles and re-solves the contacts in rest.contacts with its own IK.', bones: Object.fromEntries(Object.entries((await import('../../../../../src/lib/rig/fk.js')).BONES)) },
  rest: {
    bones: REST_ABS, hipsOffset: HIPS_OFFSET, fingers: REST_FINGERS, expressions: REST_EXPR, gaze: [0, -2],
    standingFoot: 'both', stance: 'both feet planted under the hips about hip width apart, toes slightly out, knees straight but relaxed; weight shift only as the idle sway',
    contacts: { leftHand: 'heel of the hand on the left iliac crest, fingertips forward-down on the hip (lib/body.mjs pelvis profile)', rightHand: 'free, palm toward the thigh, 3-5 cm off it' },
    goals: GOALS,
    measured: {
      leftElbowFlexDeg: r1(-REST_L.lowerArm[1]), rightElbowFlexDeg: r1(REST_R.lowerArm[1]),
      leftWristMissM: r3(REST_L.wristMissM), leftTipMissM: r3(REST_L.tipMissM), rightWristMissM: r3(REST_R.wristMissM),
    },
  },
  idle, clips, stateMachine,
};

// ---------------------------------------------------------------- frame fit and 2D parts (derived from the motion)
const yaw = spec.camera.yawDeg;
const samples = [];
for (const s of sectionsOf(spec)) {
  const d = clipDuration(s.clip);
  for (const idleT of [0, 3100]) for (let t = 0; t <= d + 0.01; t += 1000 / 30) samples.push(composite(spec, s, Math.min(t, d), idleT));
}
const restP = composite(spec, { name: 'rest', part: 'loop', clip: {}, parent: {} }, 0, 0, false);
const bboxOf = (P) => {
  const W = fk(P.pose, P.hipsOffset);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const j of Object.values(W)) { const q = project(j.p, yaw); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  return [x0, x1, y0, y1];
};
const U = samples.map(bboxOf).reduce((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])]);
const M = FRAME.skinMarginM;
// Scale: the largest that fits every pose with the skin margin; place the union box against the
// frame's left edge (her right side, the edge side once mirrored) with one margin.
const pxPerM = Math.floor(Math.min(FRAME.h / (U[3] - U[2] + 2 * M), FRAME.w / (U[1] - U[0] + 2 * M)) * 10) / 10;
const frame = { pxPerM, originXPx: r1((M - U[0]) * pxPerM), originYPx: r1((U[3] + M) * pxPerM),
  note: 'Image x = originXPx + projected x * pxPerM, image y = originYPx - projected y * pxPerM (y down). Derived from the union box of every sampled pose plus the skin margin; the checker re-derives the fit.' };

// 2D: which drawings each part needs.
const limbObs = Object.fromEntries(LIMB_PARTS.map(([n]) => [n, []]));
const turnRange = { head: [Infinity, -Infinity, Infinity, -Infinity], torso: [Infinity, -Infinity, Infinity, -Infinity], pelvis: [Infinity, -Infinity, Infinity, -Infinity] };
for (const P of samples) {
  const L = layerState(P, yaw);
  for (const [n, v] of Object.entries(L.limbs)) limbObs[n].push([v.ratio, v.depth]);
  for (const [n, v] of Object.entries(L.turns)) { const r = turnRange[n]; r[0] = Math.min(r[0], v.yaw); r[1] = Math.max(r[1], v.yaw); r[2] = Math.min(r[2], v.pitch); r[3] = Math.max(r[3], v.pitch); }
}
const restL = layerState(restP, yaw);
// Base drawing sizes at 2x the frame scale (px), w across the bone, h along it. Estimates from the skeleton, not measured art.
const BASE = { UpperArm: [40, 130], Forearm: [36, 110], Hand: [44, 80], Thigh: [60, 180], Shin: [50, 190], Shoe: [40, 60] };
const HAND_SHAPES = ['grip', 'relaxed', 'open', 'fist', 'wave'];
const parts = {};
for (const [n] of LIMB_PARTS) {
  const kind = n.replace(/^(left|right)/, '');
  const variants = ladderFor(limbObs[n], TWO_D.maxScaleDev);
  const [w, h] = BASE[kind];
  const shapes = kind === 'Hand' ? HAND_SHAPES.length : 1;
  const area = variants.reduce((a, v) => a + shapes * (v.endOn ? w * w : Math.ceil(w * h * v.nominal)), 0);
  const obs = limbObs[n].map(([r]) => r);
  parts[n] = { kind: 'limb', w, h, shapes: kind === 'Hand' ? HAND_SHAPES : undefined, variants, ratioRange: [r3(Math.min(...obs)), r3(Math.max(...obs))], areaPx: area };
}
const views = (lo, hi, step) => { const out = []; for (let a = Math.round(lo / step) * step; a <= Math.round(hi / step) * step + 1e-9; a += step) out.push(a); return out; };
{
  const h = turnRange.head;
  const yawViews = views(h[0], h[1], 10), pitchViews = views(h[2], h[3], 20);
  parts.head = { kind: 'turn', w: 150, h: 190, yawViews, pitchViews, coverDeg: { yaw: 5, pitch: 10 }, yawRange: [r1(h[0]), r1(h[1])], pitchRange: [r1(h[2]), r1(h[3])],
    areaPx: yawViews.length * pitchViews.length * 150 * 190, note: 'One head+hair drawing per (yaw, pitch) view; eyes, brows and mouth are separate parts placed by a per-view anchor and shifted by parallax between views.' };
  for (const [n, w, hh] of [['torso', 140, 170], ['pelvis', 140, 120]]) {
    const r = turnRange[n], rr = restL.turns[n];
    const spread = Math.max(Math.abs(r[0] - rr.yaw), Math.abs(r[1] - rr.yaw), Math.abs(r[2] - rr.pitch), Math.abs(r[3] - rr.pitch));
    parts[n] = { kind: 'turn', w, h: hh, yawViews: [r1(rr.yaw)], pitchViews: [r1(rr.pitch)], coverDeg: { yaw: TWO_D.noViewYawTolDeg, pitch: TWO_D.noViewYawTolDeg }, maxTurnFromRestDeg: r1(spread), areaPx: w * hh };
  }
}
const FACE = [{ name: 'eyes', w: 80, h: 30, count: 10 }, { name: 'mouth', w: 40, h: 26, count: 10 }, { name: 'brows', w: 80, h: 16, count: 4 }, { name: 'ponytail', w: 70, h: 120, count: 3 }, { name: 'neck', w: 40, h: 50, count: 1 }];
const facePx = FACE.reduce((a, p) => a + p.w * p.h * p.count, 0);
const partsPx = Object.values(parts).reduce((a, p) => a + p.areaPx, 0) + facePx;
const ATLAS = [[1024, 512], [1024, 1024], [2048, 1024], [2048, 2048]].find(([w, h]) => partsPx <= BUDGET.atlasMaxFill * w * h) ?? [4096, 2048];

spec.frame = frame;
spec.twoD = { parts, faceParts: FACE, atlas: { w: ATLAS[0], h: ATLAS[1], partsPx, fill: r3(partsPx / (ATLAS[0] * ATLAS[1])) },
  ladder: 'Limb variants: nominal ratios 1.0 / 0.64 / 0.41 / 0.26 (each covers +/-25 %), split by depth below 1.0, plus an end-on drawing for ratio <= 0.21. Only the rungs the motion uses are listed.' };
spec.budget = {
  ships: 'layered2d',
  runtimes: {
    layered2d: { evalFps: 30, ramBytes: ATLAS[0] * ATLAS[1] * 4,
      note: 'Decoded atlas RAM, flat whatever the number of actions. Work per frame: FK of 25 bones, ~30 canvas drawImage calls; 30 fps while visible, nothing runs when hidden. Measured in headless Chrome by measure_ram.mjs (artifacts/ram.json).' },
    vrm: { evalFps: 30, measured: 'artifacts/ram.json',
      note: 'three.js + three-vrm + a VRoid model. Decoded textures alone exceed the cap, so it is not shipped.' },
    sprite: { role: 'degraded', fps: 5, frameW: FRAME.w, frameH: FRAME.h, columns: 10, quantizeDeg: 4, quantizeMetres: 0.004,
      note: 'Emergency fallback only (rig failed to load). The checker measures what it breaks at its own fps; see the fallback block of its output and artifacts/fallback-sweep.json.' },
  },
  faceOverlay: { cellW: 40, cellH: 26, quantizeWeight: 0.25 },
  v4: { frames: 43, cells: 50, sheetW: 1390, sheetH: 1700, ramBytes: 1390 * 1700 * 4, webpBytes: 529794, webpBytesPerFrame: Math.round(529794 / 43) },
};

writeFileSync(OUT, JSON.stringify(spec, null, 1));
console.log(`wrote ${OUT}`);
console.log('rest L', JSON.stringify(REST_L), '\nrest R', JSON.stringify(REST_R));
console.log('stance', JSON.stringify(Object.fromEntries(SWAY_LEGS.map((b) => [b, TORSO[b]]))), 'hips', JSON.stringify(HIPS_OFFSET));
console.log('sway A', JSON.stringify(swayFit.A));
console.log('sway B', JSON.stringify(swayFit.B));
console.log('frame', JSON.stringify(frame), 'atlas', ATLAS.join('x'), partsPx);
