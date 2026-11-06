// Layered 2D rig evaluation: what a flat cut-out puppet must draw for a pose.
// Each part is a drawing pinned at its projected joint. Per frame it gets:
//   angle   the image-plane angle of its bone (deg)
//   ratio   projected bone length / true length (1 = in the image plane, 0 = pointing at the camera)
//   depth   +1 if the bone points toward the camera, -1 away
// and, for parts with turn views (head, torso, pelvis), the camera-relative yaw and pitch of the
// part's forward axis. The runtime picks a drawing variant by ratio and depth, stretches it along
// the bone by ratio / variant.nominal, and picks the head view by yaw and pitch.
import { fk, project, D2R } from './fk.mjs';

export const LIMB_PARTS = [
  ['leftUpperArm', 'leftUpperArm', 'leftLowerArm'], ['leftForearm', 'leftLowerArm', 'leftHand'], ['leftHand', 'leftHand', 'leftHandTip'],
  ['rightUpperArm', 'rightUpperArm', 'rightLowerArm'], ['rightForearm', 'rightLowerArm', 'rightHand'], ['rightHand', 'rightHand', 'rightHandTip'],
  ['leftThigh', 'leftUpperLeg', 'leftLowerLeg'], ['leftShin', 'leftLowerLeg', 'leftFoot'], ['leftShoe', 'leftFoot', 'leftToes'],
  ['rightThigh', 'rightUpperLeg', 'rightLowerLeg'], ['rightShin', 'rightLowerLeg', 'rightFoot'], ['rightShoe', 'rightFoot', 'rightToes'],
];
// Parts whose drawing turns with the body: forward axis = the joint's local +Z.
export const TURN_PARTS = [['head', 'head'], ['torso', 'upperChest'], ['pelvis', 'hips']];

/** Ratio ladder: a variant of nominal n covers ratios within +/- maxScaleDev of n; endOn covers 0..endOnMax. */
export const LADDER = [1.0, 0.64, 0.41, 0.26];
export const END_ON_MAX = 0.21;

function axisCam(j, local, yaw) {
  const m = j.m;
  const v = [m[0] * local[0] + m[1] * local[1] + m[2] * local[2], m[3] * local[0] + m[4] * local[1] + m[5] * local[2], m[6] * local[0] + m[7] * local[1] + m[8] * local[2]];
  return project(v, yaw);
}

/** 2D state of every part for one composite pose P (from compose.composite). */
export function layerState(P, yaw) {
  const W = fk(P.pose, P.hipsOffset);
  const out = { limbs: {}, turns: {}, W };
  for (const [name, a, b] of LIMB_PARTS) {
    const pa = project(W[a].p, yaw), pb = project(W[b].p, yaw);
    const trueLen = Math.hypot(W[b].p[0] - W[a].p[0], W[b].p[1] - W[a].p[1], W[b].p[2] - W[a].p[2]);
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2];
    out.limbs[name] = { x: pa[0], y: pa[1], angle: Math.atan2(dy, dx) / D2R, ratio: Math.hypot(dx, dy) / trueLen, depth: dz >= 0 ? 1 : -1 };
  }
  for (const [name, j] of TURN_PARTS) {
    const f = axisCam(W[j], [0, 0, 1], yaw);
    const up = axisCam(W[j], [0, 1, 0], yaw);
    out.turns[name] = {
      x: project(W[j].p, yaw)[0], y: W[j].p[1],
      yaw: Math.atan2(f[0], f[2]) / D2R,                  // 0 = facing the camera, + = toward image right
      pitch: Math.atan2(-f[1], Math.hypot(f[0], f[2])) / D2R, // + = chin down
      roll: Math.atan2(-up[0], up[1]) / D2R,
    };
  }
  return out;
}

/** Variant covering ratio r at depth d, or null. variants: [{nominal, depth?, endOn?}] */
export function pickVariant(variants, r, d, dev) {
  let best = null, bestErr = Infinity;
  for (const v of variants) {
    if (v.endOn) { if (r <= END_ON_MAX && (v.depth ?? d) === d && 0 < bestErr) { best = v; bestErr = 0; } continue; }
    if (v.depth !== undefined && v.depth !== d) continue;
    const err = Math.abs(r / v.nominal - 1);
    if (err <= dev && err < bestErr) { best = v; bestErr = err; }
  }
  return best;
}

/** Smallest ladder variant set covering a list of [ratio, depth] observations. */
export function ladderFor(obs, dev) {
  const need = new Map();
  for (const [r, d] of obs) {
    if (r <= END_ON_MAX) { need.set(`e${d}`, { endOn: true, depth: d }); continue; }
    let rung = null;
    for (const n of LADDER) if (Math.abs(r / n - 1) <= dev) { rung = n; break; }
    if (rung === null) rung = LADDER.reduce((a, n) => (Math.abs(r - n) < Math.abs(r - a) ? n : a), LADDER[0]);
    if (rung >= 0.99) need.set('n1', { nominal: 1.0 });
    else need.set(`n${rung}${d}`, { nominal: rung, depth: d });
  }
  return [...need.values()].sort((a, b) => (b.nominal ?? 0) - (a.nominal ?? 0) || (a.depth ?? 0) - (b.depth ?? 0));
}

/** Points the 2D rig draws, in px: every joint site plus the nose tip (head turns show as face parallax). */
export function drawnPoints(W, yaw, px) {
  const m = W.head.m, h = W.head.p, nose = [0, 0.09, 0.095];
  const n = [h[0] + m[0] * nose[0] + m[1] * nose[1] + m[2] * nose[2], h[1] + m[3] * nose[0] + m[4] * nose[1] + m[5] * nose[2], h[2] + m[6] * nose[0] + m[7] * nose[1] + m[8] * nose[2]];
  return [...Object.values(W).map((j) => j.p), n].flatMap((p) => { const q = project(p, yaw); return [q[0] * px, q[1] * px]; });
}
