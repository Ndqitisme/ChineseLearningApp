import { describe, expect, it } from 'vitest';
import { pickNext, recordExposure, TARGET_EXPOSURES, type Exposure } from './scheduler.ts';

const pool = Array.from({ length: 30 }, (_, i) => `w${i}`);
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

/** Runs the scheduler for `ticks` picks, one every `stepMin` minutes. */
function simulate(ticks: number, stepMin = 1 / 3, opts: { due?: string[]; rand?: () => number } = {}) {
  const exposure: Record<string, Exposure> = {};
  const recent: string[] = [];
  const shown: string[] = [];
  let now = 1000;
  for (let i = 0; i < ticks; i++) {
    const p = pickNext({ pool, exposure, due: opts.due ?? [], recent, now, rand: opts.rand ?? seq(0.9) });
    if (!p) break;
    recordExposure(exposure, p.id, now);
    recent.push(p.id);
    shown.push(p.id);
    now += stepMin;
  }
  return { exposure, shown };
}

describe('pickNext', () => {
  it('introduces new words in pool order and never more than the batch at once', () => {
    const { exposure, shown } = simulate(40);
    expect(shown.slice(0, 6)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']);
    const learning = Object.values(exposure).filter((e) => e.n > 0 && e.n < TARGET_EXPOSURES);
    expect(learning.length).toBeLessThanOrEqual(6);
  });

  it('does not repeat a word within the recent window when alternatives exist', () => {
    const { shown } = simulate(200);
    for (let i = 5; i < shown.length; i++) expect(shown.slice(i - 5, i)).not.toContain(shown[i]);
  });

  it('graduates words after enough exposures and keeps bringing in new ones', () => {
    const { exposure } = simulate(400);
    const graduated = Object.values(exposure).filter((e) => e.n >= TARGET_EXPOSURES).length;
    expect(graduated).toBeGreaterThan(10);
  });

  it('serves due review cards when the roll says so', () => {
    const p = pickNext({ pool, exposure: {}, due: ['w20'], recent: [], now: 0, rand: seq(0.05) });
    expect(p).toEqual({ id: 'w20', reason: 'due' });
  });

  it('skips known words outside the rare refresh roll', () => {
    const exposure: Record<string, Exposure> = { w0: { n: 1, t: 0, k: 1 } };
    const p = pickNext({ pool, exposure, due: [], recent: [], now: 10, rand: seq(0.9) });
    expect(p?.id).toBe('w1');
  });

  it('allows a repeat rather than stalling on a one-word pool', () => {
    const p = pickNext({ pool: ['only'], exposure: { only: { n: 9, t: 0 } }, due: [], recent: ['only'], now: 1 });
    expect(p).toBeNull(); // the only word was just shown: nothing else to offer
    const q = pickNext({ pool: ['a', 'b'], exposure: { a: { n: 9, t: 0 }, b: { n: 9, t: 0 } }, due: [], recent: ['b', 'a', 'b', 'a', 'b'], now: 1 });
    expect(q?.id).toBe('a');
  });
});
