// The one pose composer every consumer uses (checker, preview, 2D layer rig, VRM page):
//   final = rest + idle layers * idleWeight(t) + action delta, channel by channel.
// idleWeight(t) ramps between 1 (idle only) and the clip's weight over spec.idle.rampMs at the
// ends of a section that touch rest, so the idle layer never steps when a clip starts or ends.
import { idleAt, actionAt, clipDuration, ROTATING, sampleTrack } from './fk.mjs';

export const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Sections of every clip: { name, part, clip, parent }. part is oneShot | enter | loop | exit. */
export function sectionsOf(spec) {
  const out = [];
  for (const [name, clip] of Object.entries(spec.clips ?? {})) {
    if (clip.kind === 'stateful') { for (const part of ['enter', 'loop', 'exit']) if (clip[part]) out.push({ name, part, clip: clip[part], parent: clip }); }
    else out.push({ name, part: 'oneShot', clip, parent: clip });
  }
  return out;
}

/** 0 at a rest end of the section, 1 inside it: how much of the clip's idle weight applies. */
export function idleBlend(spec, s, t) {
  const ramp = spec.idle?.rampMs ?? 0;
  const dur = clipDuration(s.clip);
  const startsAtRest = s.part === 'oneShot' || s.part === 'enter';
  const endsAtRest = s.part === 'oneShot' || s.part === 'exit';
  let k = 1;
  if (ramp > 0 && startsAtRest) k = Math.min(k, smooth(t / ramp));
  if (ramp > 0 && endsAtRest) k = Math.min(k, smooth((dur - t) / ramp));
  if (!(ramp > 0) && (startsAtRest || endsAtRest)) k = 1; // no ramp declared: weight steps (the checker flags it)
  return k;
}

/** Pose of section s at local time t, with the idle layer at absolute time t + idleT. */
export function composite(spec, s, t, idleT = 0, withIdle = true) {
  const rest = spec.rest;
  const a = actionAt(s.clip, t);
  const w = s.parent.idleWeight ?? {};
  const driven = new Set(Object.keys(s.clip.bones ?? {}));
  const k = idleBlend(spec, s, t);
  const clipW = (b) => w[b] ?? (driven.has(b) ? (spec.idle?.drivenWeight ?? 0.35) : 1);
  const idl = withIdle ? idleAt(spec.idle, t + idleT, (b) => 1 + (clipW(b) - 1) * k) : { pose: {}, expr: {} };
  const pose = {};
  for (const b of ROTATING) {
    const r = rest.bones[b] ?? [0, 0, 0], i = idl.pose[b] ?? [0, 0, 0], d = a.pose[b] ?? [0, 0, 0];
    pose[b] = [0, 1, 2].map((j) => r[j] + i[j] + d[j]);
  }
  const expr = {};
  for (const key of new Set([...Object.keys(rest.expressions ?? {}), ...Object.keys(a.expr), ...Object.keys(idl.expr)]))
    expr[key] = (rest.expressions?.[key] ?? 0) + (a.expr[key] ?? 0) + (idl.expr[key] ?? 0);
  const hipsOffset = (rest.hipsOffset ?? [0, 0, 0]).map((x, j) => x + a.root[j]);
  const gaze = [(rest.gaze?.[0] ?? 0) + a.gaze[0], (rest.gaze?.[1] ?? 0) + a.gaze[1]];
  const fingers = {};
  for (const side of ['left', 'right']) {
    const tr = s.clip.fingers?.[side];
    const d = tr ? sampleTrack(tr, t) : [0, 0, 0];
    fingers[side] = (rest.fingers?.[side] ?? [0, 0, 0]).map((x, j) => x + d[j]);
  }
  return { pose, expr, hipsOffset, gaze, fingers, delta: a, idleBlend: k };
}

/** Idle only (no clip), at absolute time T. */
export function idleOnly(spec, T) {
  return composite(spec, { name: 'idle', part: 'loop', clip: {}, parent: {} }, 0, T, true);
}
