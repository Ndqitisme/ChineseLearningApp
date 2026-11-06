// Body geometry on the FK skeleton: centre of mass, support point, pelvis and torso volumes,
// contact distances. Shared by the generator (to solve the rest pose) and the checker (authority).
import { BODY, MASS } from './limits.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** World vector -> local frame of a joint (m is row-major world rotation, local = m^T v). */
export function toLocal(j, p) {
  const d = sub(p, j.p), m = j.m;
  return [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
}
export function toWorld(j, l) {
  const m = j.m;
  return [j.p[0] + m[0] * l[0] + m[1] * l[1] + m[2] * l[2], j.p[1] + m[3] * l[0] + m[4] * l[1] + m[5] * l[2], j.p[2] + m[6] * l[0] + m[7] * l[1] + m[8] * l[2]];
}

export function centreOfMass(W) {
  let m = 0;
  const c = [0, 0, 0];
  for (const [a, b, w] of MASS) { for (let k = 0; k < 3; k++) c[k] += w * (W[a].p[k] + W[b].p[k]) / 2; m += w; }
  return c.map((x) => x / m);
}
/** Ground support point of a foot: midway between ankle and toe. */
export const supportOf = (W, foot) => W[foot].p.map((x, k) => (x + W[foot.replace('Foot', 'Toes')].p[k]) / 2);
export const groundDist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Line angle (deg, left side up = +) between a left and right joint, in the image plane facing her. */
export const lineDeg = (W, left, right) => Math.atan2(W[left].p[1] - W[right].p[1], W[left].p[0] - W[right].p[0]) * 180 / Math.PI;

/** Pelvis cross-section (a, b) at hips-local height y, or null outside the profile. */
export function pelvisSection(y) {
  const P = BODY.pelvisProfile;
  if (y < P[0][0] || y > P[P.length - 1][0]) return null;
  let i = 0;
  while (P[i + 1][0] < y) i++;
  const u = (y - P[i][0]) / (P[i + 1][0] - P[i][0]);
  return [P[i][1] + u * (P[i + 1][1] - P[i][1]), P[i][2] + u * (P[i + 1][2] - P[i][2])];
}
/** Ellipse value ((x/a)^2 + (z/b)^2) of a world point against the pelvis, or null outside its height. */
export function pelvisE(W, p) {
  const l = toLocal(W.hips, p), s = pelvisSection(l[1]);
  return s ? (l[0] / s[0]) ** 2 + (l[2] / s[1]) ** 2 : null;
}
/** Signed distance (m) from a world point to the pelvis surface at its height (negative inside). */
export function pelvisDist(W, p) {
  const l = toLocal(W.hips, p), s = pelvisSection(l[1]);
  if (!s) return null;
  let best = Infinity;
  for (let i = 0; i < 720; i++) {
    const th = (i / 720) * 2 * Math.PI;
    best = Math.min(best, Math.hypot(l[0] - s[0] * Math.cos(th), l[2] - s[1] * Math.sin(th)));
  }
  const e = (l[0] / s[0]) ** 2 + (l[2] / s[1]) ** 2;
  return e < 1 ? -best : best;
}
/** Point on the pelvis surface (world) at hips-local height y and angle th (0 = her left side, 90 = front). */
export function pelvisPoint(W, y, thDeg) {
  const s = pelvisSection(y), th = thDeg * Math.PI / 180;
  return toWorld(W.hips, [s[0] * Math.cos(th), y, s[1] * Math.sin(th)]);
}
export function torsoE(W, p, hipsLiftY = 0) {
  const T = BODY.torso;
  if (!(p[1] > T.yFrom + hipsLiftY && p[1] < T.yTo + hipsLiftY)) return null;
  const c = W.chest.p, b = p[1] > T.bSplitY + hipsLiftY ? T.bHigh : T.bLow;
  return ((p[0] - c[0]) / T.a) ** 2 + ((p[2] - c[2]) / b) ** 2;
}
/** Hand sample points for penetration: wrist, mid-hand, fingertip. */
export const handSites = (W, side) => [[`${side}Hand`, W[`${side}Hand`].p], [`${side}MidHand`, W[`${side}Hand`].p.map((x, k) => (x + W[`${side}HandTip`].p[k]) / 2)], [`${side}HandTip`, W[`${side}HandTip`].p]];
