// Small numeric solvers used only by gen_spec.mjs to turn readable targets ("wrist on the hip
// bone, elbow out and back") into Euler angles in the declared convention. Deterministic:
// pattern search from fixed starts, no randomness. Joint limits from lib/limits.mjs are a
// penalty, so solutions stay inside the ranges the checker enforces.
import { fk } from './fk.mjs';
import { LIMITS } from './limits.mjs';

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const AX = ['x', 'y', 'z'];
export function limitPenalty(bone, v, margin = 3) {
  const lim = LIMITS[bone];
  if (!lim) return 0;
  let c = 0;
  v.forEach((x, k) => {
    const [lo, hi] = lim[AX[k]];
    const m = Math.min(margin, (hi - lo) / 4);
    if (x < lo + m) c += (lo + m - x) ** 2;
    if (x > hi - m) c += (x - hi + m) ** 2;
  });
  return 1e-3 * c;
}

export function search(p, cost, maxIt = 6000, step0 = 4) {
  let step = step0, c0 = cost(p);
  for (let it = 0; it < maxIt && step > 0.01; it++) {
    let improved = false;
    for (let i = 0; i < p.length; i++) for (const dir of [1, -1]) {
      const q = p.slice(); q[i] += dir * step;
      const c = cost(q);
      if (c < c0) { p = q; c0 = c; improved = true; }
    }
    if (!improved) step *= 0.5;
  }
  return p;
}

const memo = new Map();
/**
 * goal: { wrist:[x,y,z], elbow?:[x,y,z] swivel hint, tip?:[x,y,z] }
 * The elbow is a pure hinge (lowerArm = [0, flex, 0]); the hinge plane comes from upperArm.x,
 * humeral rotation. q = [upperArm x, y, z, elbow flex, hand y, hand z].
 * Returns { upperArm, lowerArm, hand, wristMissM, tipMissM, elbowAt }. Identical (base, side, goal)
 * give identical answers, so a pose reused across clip sections never jumps at a seam.
 */
export function solveArm(base, side, goal, start) {
  const key = JSON.stringify([base, side, goal.wrist, goal.elbow, goal.tip]);
  if (memo.has(key)) return memo.get(key);
  const s = side === 'left' ? 1 : -1;
  const U = `${side}UpperArm`, Lo = `${side}LowerArm`, H = `${side}Hand`, T = `${side}HandTip`;
  const pose = (q) => ({ ...base, [U]: [q[0], q[1], q[2]], [Lo]: [0, q[3], 0], [H]: [0, q[4], q[5]] });
  const cost = (q) => {
    const w = fk(pose(q));
    let c = 400 * dist2(w[H].p, goal.wrist);
    if (goal.elbow) {
      // Swivel hint: the elbow should lie toward the hint as seen from the shoulder-wrist midpoint.
      const S = w[U].p, W = w[H].p, E = w[Lo].p;
      const M = [(S[0] + W[0]) / 2, (S[1] + W[1]) / 2, (S[2] + W[2]) / 2];
      const a = E.map((v, i) => v - M[i]), b = goal.elbow.map((v, i) => v - M[i]);
      const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
      c += 0.2 * (1 - cos);
    }
    if (goal.tip) c += 40 * dist2(w[T].p, goal.tip);
    c += limitPenalty(U, [q[0], q[1], q[2]]) + limitPenalty(Lo, [0, q[3], 0]) + limitPenalty(H, [0, q[4], q[5]]);
    c += 1e-6 * (q[4] ** 2 + q[5] ** 2) + 2e-7 * q[0] ** 2;
    return c;
  };
  const miss = (q) => Math.sqrt(dist2(fk(pose(q))[H].p, goal.wrist));
  // Warm start keeps neighbouring keys on the same branch; if it lands in a local minimum that
  // misses the wrist, fall back to fixed starts and keep the best.
  const starts = [[0, 20 * s, -70 * s, -60 * s, 0, 0], [0, -30 * s, -40 * s, -90 * s, 0, 0], [40 * s, 0, -60 * s, -100 * s, 0, 0], [-40 * s, 10 * s, -60 * s, -100 * s, 0, 0]];
  let p = search(start ?? starts[0], cost);
  if (miss(p) > 0.005) {
    for (const q0 of starts) {
      const q = search(q0, cost);
      if (cost(q) < cost(p)) p = q;
    }
  }
  const r = (v) => Math.round(v * 10) / 10;
  const out0 = { upperArm: [r(p[0]), r(p[1]), r(p[2])], lowerArm: [0, r(p[3]), 0], hand: [0, r(p[4]), r(p[5])] };
  const w = fk({ ...base, [U]: out0.upperArm, [Lo]: out0.lowerArm, [H]: out0.hand });
  const out = {
    ...out0,
    wristMissM: Math.sqrt(dist2(w[H].p, goal.wrist)),
    tipMissM: goal.tip ? Math.sqrt(dist2(w[T].p, goal.tip)) : 0,
    elbowAt: w[Lo].p.map((v) => Math.round(v * 1000) / 1000),
  };
  memo.set(key, out);
  return out;
}

/**
 * Keeps both feet where they are in `restPose` while the hips move by `hipsOffset` (and torso
 * angles in `base` change): solves upperLeg xyz, lowerLeg x and foot x per side so the ankle and
 * the toe stay planted. Returns { left: {upperLeg, lowerLeg, foot}, right: {...} } as absolute angles.
 */
export function plantFeet(restPose, restOffset, base, hipsOffset) {
  const rw = fk(restPose, restOffset);
  const out = {};
  for (const side of ['left', 'right']) {
    const UL = `${side}UpperLeg`, LL = `${side}LowerLeg`, F = `${side}Foot`;
    const ankle = rw[F].p, toe = rw[`${side}Toes`].p;
    const pose = (q) => ({ ...restPose, ...base, [UL]: [q[0], q[1], q[2]], [LL]: [q[3], 0, 0], [F]: [q[4], restPose[F][1], restPose[F][2]] });
    const cost = (q) => {
      const w = fk(pose(q), hipsOffset);
      return 400 * dist2(w[F].p, ankle) + 100 * dist2(w[`${side}Toes`].p, toe)
        + limitPenalty(UL, [q[0], q[1], q[2]], 1) + limitPenalty(LL, [q[3], 0, 0], 0) + limitPenalty(F, [q[4], 0, 0], 1);
    };
    const p = search([...restPose[UL], restPose[LL][0], restPose[F][0]], cost);
    const r = (v) => Math.round(v * 10) / 10;
    out[side] = { upperLeg: p.slice(0, 3).map(r), lowerLeg: [r(p[3]), 0, 0], foot: [r(p[4]), restPose[F][1], restPose[F][2]] };
  }
  return out;
}
