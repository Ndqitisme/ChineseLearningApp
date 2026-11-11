import { afterEach, describe, expect, it, vi } from 'vitest';
import { SWAY_MAX } from './leaves.ts';
import { MEADOW, SWAY_REF, boxWidth, swayLeaves } from './meadow.ts';
import { createDragTracker, createSway, followWindow, frameLoop, turnDeg } from './sway.ts';

const LEAF_LEAVES = swayLeaves(MEADOW.sprites);
const W = boxWidth(MEADOW.pad);
const FRAME = 1000 / 60;

/** Runs the springs at 60 fps from `from` until they stop or `until`: stop time, largest turn (deg), largest turning
 * speed (deg/s) and the most direction changes any one leaf made. */
function run(s: ReturnType<typeof createSway>, from: number, until: number, each?: (t: number) => void) {
  const n = s.turn.length;
  let max = 0, maxSpeed = 0;
  const prev = Array.from({ length: n }, (_, i) => turnDeg(s, i));
  const dir = new Array<number>(n).fill(0), flips = new Array<number>(n).fill(0);
  for (let t = from; t <= until; t += FRAME) {
    each?.(t);
    const moving = s.step(t);
    for (let i = 0; i < n; i++) {
      const d = turnDeg(s, i), v = (d - prev[i]) / (FRAME / 1000);
      max = Math.max(max, Math.abs(d));
      maxSpeed = Math.max(maxSpeed, Math.abs(v));
      // Count only real reversals, not sub-0.05° jitter around a turning point.
      if (Math.abs(d - prev[i]) > 0.002) {
        const sd = Math.sign(d - prev[i]);
        if (dir[i] && sd !== dir[i] && Math.abs(d) > 0.05) flips[i]++;
        dir[i] = sd;
      }
      prev[i] = d;
    }
    if (!moving) return { stoppedAt: t, max, maxSpeed, flips: Math.max(...flips) };
  }
  return { stoppedAt: Infinity, max, maxSpeed, flips: Math.max(...flips) };
}

describe('leaf sway', () => {
  it('a gust gives one slow, visible lean and a soft return, then the leaves are still', () => {
    const s = createSway(LEAF_LEAVES, W, SWAY_REF);
    s.gust(10, 0);
    const { stoppedAt, max, maxSpeed, flips } = run(s, 0, 20_000);
    expect(max).toBeGreaterThan(5);
    expect(maxSpeed).toBeLessThan(45);
    expect(flips).toBeLessThanOrEqual(2);
    expect(stoppedAt).toBeLessThan(8_000);
    expect([...s.turn].every((t) => t === 0)).toBe(true);
  });

  it(`gusts on every word and a long hard drag never turn a leaf past ${SWAY_MAX}°`, () => {
    const s = createSway(LEAF_LEAVES, W, SWAY_REF);
    const { max } = run(s, 0, 4_000, (t) => {
      if (t % 300 < FRAME) s.gust(40, t);
      s.push(t < 2000 ? 60_000 : -60_000, 9_000);
    });
    expect(max).toBeLessThanOrEqual(SWAY_MAX + 1e-9);
  });

  it('nothing pushing, nothing moves: the loop stops at once', () => {
    const s = createSway(LEAF_LEAVES, W, SWAY_REF);
    expect(s.step(0)).toBe(false);
  });

  it('dragging right leans an upright leaf back to the left, slowly, and it settles after the drop', () => {
    const up = { ax: 0, ay: 0, x: 0, y: 0, angle: -90, length: 18 };
    const s = createSway([up], W);
    const during = run(s, 0, 1200, () => s.push(3_000, 0));
    expect(turnDeg(s, 0)).toBeLessThan(-4); // counter-clockwise: the tip lags behind the drag
    expect(during.maxSpeed).toBeLessThan(45);
    s.push(0, 0);
    expect(run(s, 1200, 20_000).stoppedAt).toBeLessThan(9_000);
  });

  it('bad input (not a number) is ignored instead of freezing the leaves', () => {
    const s = createSway(LEAF_LEAVES, W, SWAY_REF);
    s.push(NaN, Infinity);
    s.gust(10, 0);
    const { stoppedAt } = run(s, 0, 20_000);
    expect(stoppedAt).toBeLessThan(8_000);
  });
});

describe('pointer brush', () => {
  it('a kick leans only the part it hits, the way it pushes, and the part settles again', () => {
    const s = createSway(LEAF_LEAVES, W, SWAY_REF);
    s.kick(3, 1_700, 0, 0); // a pointer passing right at about 300 px/s
    let peak = 0, others = 0;
    for (let t = 0; t <= 1_500; t += FRAME) {
      s.step(t);
      peak = Math.max(peak, turnDeg(s, 3));
      LEAF_LEAVES.forEach((_, i) => { if (i !== 3) others = Math.max(others, Math.abs(turnDeg(s, i))); });
    }
    expect(peak).toBeGreaterThan(4); // clockwise: an upright plant's top goes right with the pointer
    expect(others).toBe(0);
    expect(run(s, 1_500, 20_000).stoppedAt).toBeLessThan(10_000);
  });

  it('a kick with a bad index or value does nothing', () => {
    const s = createSway(LEAF_LEAVES, W, SWAY_REF);
    s.kick(-1, 1_000, 0, 0);
    s.kick(LEAF_LEAVES.length, 1_000, 0, 0);
    s.kick(0, NaN, 0, 0);
    expect(s.step(0)).toBe(false);
  });
});

describe('drag tracker', () => {
  it('speeding up to the right reads as positive x acceleration, and it reads zero after the window stops', () => {
    const d = createDragTracker();
    let x = 0, v = 0, seen = 0;
    for (let t = 0; t <= 400; t += 8) { v += 20_000 * 0.008; x += v * 0.008; d.moved(x, 0, t); seen = Math.max(seen, d.accel(t)[0]); }
    expect(seen).toBeGreaterThan(3_000);
    for (let t = 408; t <= 3_000; t += 16) d.accel(t);
    expect(d.accel(3_016)).toEqual([0, 0]);
    expect(d.idle).toBe(true);
  });

  it('a steady drag keeps the plants trailing behind for as long as the window moves, then they settle', () => {
    const up = { ax: 0, ay: 0, x: 0, y: 0, angle: -90, length: 50 };
    const s = createSway([up], W, SWAY_REF);
    const d = createDragTracker();
    const leans: number[] = [];
    for (let t = 0; t <= 2_500; t += FRAME) {
      if (t <= 2_000) d.moved(0.8 * t, 0, t); // 800 px/s to the right for 2 s, then the window stops
      s.push(...d.felt(t));
      s.step(t);
      leans.push(turnDeg(s, 0));
    }
    // Mid-drag, long after the start jolt, the plant still leans back (counter-clockwise) by a visible amount.
    const mid = leans[Math.round(1_500 / FRAME)];
    expect(mid).toBeLessThan(-15);
    let stopped = false;
    for (let t = 2_500; t <= 20_000 && !stopped; t += FRAME) { s.push(...d.felt(t)); stopped = !s.step(t) && d.idle; }
    expect(stopped).toBe(true);
  });

  it('jerky move events during a steady drag still give a steady lean, not spikes', () => {
    const d = createDragTracker();
    const out: number[] = [];
    // Constant 800 px/s, but events arrive in irregular bursts (0–24 ms apart) with ±2 px jitter.
    let t = 0;
    for (let k = 0; k < 120; k++) {
      t += [0, 4, 24, 8, 16][k % 5];
      d.moved(0.8 * t + ((k * 7) % 5) - 2, 0, t);
      if (k % 2) out.push(Math.abs(d.accel(t)[0]));
    }
    const tail = out.slice(out.length / 2);
    expect(Math.max(...tail)).toBeLessThan(4_000);
  });
});

describe('window follower', () => {
  it('feeds every change of the window position to the tracker, and stops 1.5 s after the window is still', () => {
    let pos = [100, 200];
    const seen: number[][] = [];
    const f = followWindow({ moved: (x, y, t) => seen.push([x, y, t]) }, () => pos);
    expect(f.step(0)).toBe(false); // not started
    f.start(0);
    for (let t = 16; t <= 400; t += 16) { pos = [100 + t, 200]; expect(f.step(t)).toBe(true); }
    expect(seen.length).toBe(1 + 25);
    expect(seen[seen.length - 1]).toEqual([500, 200, 400]);
    expect(f.step(1_800)).toBe(true);   // still for 1.4 s: keeps following
    expect(f.step(1_920)).toBe(false);  // still for 1.52 s: done
    expect(seen.length).toBe(26);
  });
});

describe('frame loop', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('keeps running frames when animation frames never arrive, and stops when the frame says so', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let calls = 0;
    const loop = frameLoop(() => ++calls < 5);
    loop.wake();
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(5);
  });

  it('a frame that throws does not leave the loop stuck for the next wake', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let calls = 0;
    const loop = frameLoop(() => { calls++; if (calls === 1) throw new Error('boom'); return false; });
    loop.wake();
    expect(() => vi.advanceTimersByTime(150)).toThrow('boom');
    loop.wake();
    vi.advanceTimersByTime(150);
    expect(calls).toBe(2);
  });
});
