// Leaf motion for the border skins: each leaf is a damped spring about its pivot, pushed by gusts and by the window's
// own acceleration while it is dragged. The loop runs only until every leaf is still again, because the hint panel
// window is over its CPU budget (docs/PLAN.md section 6); it never runs continuously.
// The motion is slow on purpose: one unhurried lean and a soft return, never a quick flutter.

import { SWAY_MAX, type Leaf } from './leaves.ts';

const RAD = Math.PI / 180;
/** Natural frequency of a part of the reference length, rad/s: one sway takes a little over 2 s. Shorter parts are a
 * little stiffer, longer ones a little slower, within FREQ_SPREAD either way. */
const OMEGA = 2 * Math.PI * 0.45;
const FREQ_SPREAD = [0.8, 1.25] as const;
/** Damping ratio: one lean and a soft return with a barely visible overshoot (about 5%); no flutter. */
const ZETA = 0.7;
/** Lean (rad) per px/s² of push across the leaf, before the soft limit: an ordinary drag (about 1500 px/s² once
 * smoothed, measured on a real drag) leans a plant about 12°. */
const PUSH_GAIN = 1.5e-4;
/** Pushes saturate smoothly toward this lean, so a hard drag eases into the limit instead of hitting it. */
const SOFT_LEAN = 22 * RAD;
/** Below this turn (deg) and speed (deg/s) a leaf counts as still. */
const REST_ANGLE = 0.1;
const REST_SPEED = 0.5;
/** A gust drifts across the 330px top edge in about 1.3 s, left to right, and blows on each leaf for 1.8 s. */
const GUST_SPEED = 260;
const GUST_MS = 1800;
/** A brushing pointer's push on one part fades over this long, s. */
const KICK_TAU = 0.5;
/** Steps longer than this (a stalled frame) are split, so the spring stays stable. */
const MAX_STEP = 1 / 120;

interface Gust { start: number; strength: number; dir: [number, number] }

export interface Sway {
  /** Turn of each leaf away from its rest angle, radians, in `leaves` order. */
  readonly turn: Float64Array;
  /** A burst of wind; `strength` is roughly the peak lean in degrees it gives a leaf across the wind. */
  gust(strength: number, now: number): void;
  /** The window's acceleration in CSS px/s², while it is being dragged; zero once it stops. */
  push(ax: number, ay: number): void;
  /** A push on part `i` alone (px/s², like `push` but in the push's own direction) that fades over KICK_TAU: a
   * pointer brushing past it. */
  kick(i: number, fx: number, fy: number, now: number): void;
  /** Advances the springs to `now` (ms). Returns false once every leaf is still and nothing pushes. */
  step(now: number): boolean;
}

/** Deterministic per-leaf spread, so neighbours do not swing in lockstep. */
const spread = (i: number) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** `width` is the frame box width; pivots are placed on it to time the gust front. `refLength` is the length that
 * sways at the base frequency. */
export function createSway(leaves: Leaf[], width: number, refLength = 18): Sway {
  const n = leaves.length;
  const turn = new Float64Array(n);
  const speed = new Float64Array(n);
  const omega = leaves.map((l, i) =>
    OMEGA * Math.min(Math.max(Math.sqrt(refLength / l.length), FREQ_SPREAD[0]), FREQ_SPREAD[1]) * (0.9 + 0.2 * spread(i)));
  const pivotX = leaves.map((l) => l.ax * width + l.x);
  const jitter = leaves.map((_, i) => 0.6 + 0.8 * spread(i + 101));
  let gusts: Gust[] = [];
  let pushX = 0, pushY = 0;
  const kickX = new Float64Array(n), kickY = new Float64Array(n);
  let last: number | null = null;

  /** The lean (rad) a steady push (fx, fy) in px/s² would hold leaf `i` at, softly limited. */
  const target = (i: number, t: number, fx: number, fy: number) => {
    const a = leaves[i].angle * RAD + t;
    // Clockwise is positive on screen (y down): the cross product of the leaf axis with the push.
    const lean = PUSH_GAIN * (Math.cos(a) * fy - Math.sin(a) * fx);
    return SOFT_LEAN * Math.tanh(lean / SOFT_LEAN);
  };

  return {
    turn,
    gust(strength, now) {
      // Mostly sideways with a little lift; flips direction now and then so repeated words do not look canned.
      const dirX = spread(Math.floor(now / 997)) < 0.75 ? 1 : -1;
      gusts.push({ start: now, strength: (strength * RAD) / PUSH_GAIN, dir: [dirX, -0.35] });
      last ??= now;
    },
    push(ax, ay) {
      pushX = Number.isFinite(ax) ? ax : 0;
      pushY = Number.isFinite(ay) ? ay : 0;
    },
    kick(i, fx, fy, now) {
      if (!(i >= 0 && i < n) || !Number.isFinite(fx) || !Number.isFinite(fy)) return;
      kickX[i] = fx;
      kickY[i] = fy;
      last ??= now;
    },
    step(now) {
      if (last === null || now < last) last = now;
      let remaining = Math.min((now - last) / 1000, 0.25);
      last = now;
      gusts = gusts.filter((g) => now - g.start < GUST_MS + (width / GUST_SPEED) * 1000);
      while (remaining > 1e-6) {
        const dt = Math.min(remaining, MAX_STEP);
        remaining -= dt;
        for (let i = 0; i < n; i++) {
          // Inertia: in the window's frame a leaf feels the opposite of the window's acceleration.
          let fx = kickX[i] - pushX, fy = kickY[i] - pushY;
          for (const g of gusts) {
            const t = now - g.start - (pivotX[i] / GUST_SPEED) * 1000;
            if (t < 0 || t > GUST_MS) continue;
            // sin² rises and falls with zero slope at both ends: the gust fades in and out.
            const f = g.strength * jitter[i] * Math.sin((Math.PI * t) / GUST_MS) ** 2;
            fx += g.dir[0] * f;
            fy += g.dir[1] * f;
          }
          const w = omega[i];
          const acc = w * w * (target(i, turn[i], fx, fy) - turn[i]) - 2 * ZETA * w * speed[i];
          // Semi-implicit Euler: stable for these stiffnesses at MAX_STEP.
          speed[i] += acc * dt;
          turn[i] += speed[i] * dt;
          const max = SWAY_MAX * RAD;
          if (turn[i] > max) { turn[i] = max; speed[i] = Math.min(0, speed[i]); }
          else if (turn[i] < -max) { turn[i] = -max; speed[i] = Math.max(0, speed[i]); }
          if (!Number.isFinite(turn[i]) || !Number.isFinite(speed[i])) { turn[i] = 0; speed[i] = 0; }
        }
        const fade = Math.exp(-dt / KICK_TAU);
        for (let i = 0; i < n; i++) {
          kickX[i] = Math.abs(kickX[i]) < 1 ? 0 : kickX[i] * fade;
          kickY[i] = Math.abs(kickY[i]) < 1 ? 0 : kickY[i] * fade;
        }
      }
      let moving = gusts.length > 0 || pushX !== 0 || pushY !== 0;
      for (let i = 0; i < n && !moving; i++) {
        if (Math.abs(turn[i]) > REST_ANGLE * RAD || Math.abs(speed[i]) > REST_SPEED * RAD || kickX[i] || kickY[i]) moving = true;
      }
      if (!moving) { turn.fill(0); speed.fill(0); kickX.fill(0); kickY.fill(0); last = null; }
      return moving;
    },
  };
}

/** Turns angles in radians held by a Sway into degrees for drawing. */
export const turnDeg = (s: Sway, i: number) => s.turn[i] / RAD;

/** Velocity is smoothed over this long, and the acceleration taken from it over this long again, so a jerky
 * drag still reads as one steady lean. */
const VELOCITY_TAU = 0.12;
const ACCEL_TAU = 0.3;
/** Air drag as an acceleration per px/s of window speed: a plant carried through the air trails behind for as long
 * as it moves, not only when the drag starts or stops. A steady 600 px/s drag leans a plant about 20°, a fast one
 * eases into SOFT_LEAN. */
const AIR_DRAG = 6.5;

/** Window motion from its drag positions: velocity over the last samples, then its change, both smoothed. */
export function createDragTracker() {
  let samples: { x: number; y: number; t: number }[] = [];
  let vx = 0, vy = 0, ax = 0, ay = 0, lastT: number | null = null;
  return {
    moved(x: number, y: number, t: number) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      samples.push({ x, y, t });
      if (samples.length > 8) samples.shift();
    },
    /** Acceleration at `now`, CSS px/s². The window counts as stopped 80 ms after its last move. */
    accel(now: number): [number, number] {
      samples = samples.filter((s) => now - s.t < 80);
      let nvx = 0, nvy = 0;
      if (samples.length >= 2) {
        const a = samples[0], b = samples[samples.length - 1];
        const dt = Math.max((b.t - a.t) / 1000, 4e-3);
        nvx = (b.x - a.x) / dt;
        nvy = (b.y - a.y) / dt;
      }
      const dt = lastT === null ? 0 : Math.min(Math.max((now - lastT) / 1000, 1e-3), 0.1);
      lastT = now;
      if (dt) {
        const kv = Math.min(1, dt / VELOCITY_TAU), ka = Math.min(1, dt / ACCEL_TAU);
        const svx = vx + (nvx - vx) * kv, svy = vy + (nvy - vy) * kv;
        ax += ((svx - vx) / dt - ax) * ka;
        ay += ((svy - vy) / dt - ay) * ka;
        vx = svx;
        vy = svy;
      }
      // Below these the lean they give is under 0.1°.
      if (!samples.length && Math.abs(ax) < 30 && Math.abs(ay) < 30 && Math.abs(vx) < 1.5 && Math.abs(vy) < 1.5) {
        ax = ay = vx = vy = 0;
        lastT = null;
      }
      return [ax, ay];
    },
    /** What a plant feels at `now`: the window's acceleration (inertia) plus the air its motion pushes through. */
    felt(now: number): [number, number] {
      const [x, y] = this.accel(now);
      return [x + AIR_DRAG * vx, y + AIR_DRAG * vy];
    },
    get idle() { return samples.length === 0 && ax === 0 && ay === 0; },
  };
}

type WindEvent = { kind: 'gust'; strength: number } | { kind: 'dragStart' };
const listeners = new Set<(e: WindEvent) => void>();

/** What the hint panel tells a border skin; nothing happens when no skin with moving leaves is shown. */
export const frameWind = {
  /** A new word, or the pointer coming onto the bubble. */
  gust: (strength: number) => listeners.forEach((f) => f({ kind: 'gust', strength })),
  /** A drag of the window has begun; the skin follows the window's position itself (followWindow). */
  dragStart: () => listeners.forEach((f) => f({ kind: 'dragStart' })),
  listen(f: (e: WindEvent) => void) {
    listeners.add(f);
    return () => { listeners.delete(f); };
  },
};

/** Follows the window's screen position during a drag, for the drag tracker. Windows stops passing the window's
 * Moved events to the page a moment into a drag, but window.screenX/screenY keep up, so the skin reads those each
 * frame. Following ends once the window has been still for FOLLOW_MS. */
const FOLLOW_MS = 1500;
export function followWindow(tracker: { moved(x: number, y: number, t: number): void }, read = () => [screenX, screenY]) {
  let since: number | null = null, x = 0, y = 0;
  return {
    start(now: number) {
      [x, y] = read();
      since = now;
      tracker.moved(x, y, now);
    },
    /** Samples the position; true while still following. */
    step(now: number) {
      if (since === null) return false;
      const [nx, ny] = read();
      if (nx !== x || ny !== y) {
        x = nx;
        y = ny;
        since = now;
        tracker.moved(x, y, now);
      } else if (now - since > FOLLOW_MS) since = null;
      return since !== null;
    },
  };
}

/** Runs `frame` each animation frame while it returns true, and restarts on `wake()`. Windows can hold back
 * animation frames while it moves a window; a timer then stands in, so the loop can never be left waiting on a
 * frame that does not come. */
export function frameLoop(frame: (now: number) => boolean) {
  let raf = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = 0;
    timer = undefined;
    let again = false;
    try { again = frame(performance.now()); } finally { if (again) wake(); }
  };
  const wake = () => {
    if (raf || timer) return;
    raf = requestAnimationFrame(run);
    timer = setTimeout(run, 100);
  };
  return { wake, stop: () => { if (raf) cancelAnimationFrame(raf); clearTimeout(timer); raf = 0; timer = undefined; } };
}
