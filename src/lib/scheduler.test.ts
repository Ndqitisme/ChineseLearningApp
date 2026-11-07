import { describe, expect, it } from 'vitest';
import { GAP_MIN, pickNext, recordExposure, TARGET_EXPOSURES, type Exposure } from './scheduler.ts';

const pool = Array.from({ length: 30 }, (_, i) => `w${i}`);
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

/** Runs the scheduler for `ticks` turns, one every `stepMin` minutes; a turn with no pick shows nothing. */
function simulate(ticks: number, stepMin = 1 / 3, opts: { due?: string[]; rand?: () => number; pool?: string[]; exposure?: Record<string, Exposure> } = {}) {
  const exposure: Record<string, Exposure> = { ...opts.exposure };
  let empty = 0;
  const recent: string[] = [];
  const shown: string[] = [];
  const log: { id: string; at: number; before?: Exposure }[] = [];
  let now = 1000;
  for (let i = 0; i < ticks; i++, now += stepMin) {
    const p = pickNext({ pool: opts.pool ?? pool, exposure, due: opts.due ?? [], recent, now, rand: opts.rand ?? seq(0.9) });
    if (!p) { empty++; continue; }
    log.push({ id: p.id, at: now, before: exposure[p.id] && { ...exposure[p.id] } });
    recordExposure(exposure, p.id, now);
    recent.push(p.id);
    shown.push(p.id);
  }
  return { exposure, shown, log, empty };
}

describe('pickNext', () => {
  it('introduces new words in pool order, more than the batch only when nothing else can be shown', () => {
    expect(simulate(40).shown.slice(0, 6)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']);
    // With familiar words to fill the waits, the new-word group stays at the batch size.
    const old = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const { exposure } = simulate(200, 0.3, { pool: [...old, ...pool], exposure: Object.fromEntries(old.map((id, i) => [id, { n: 9, t: i }])) });
    const learning = Object.values(exposure).filter((e) => e.n > 0 && e.n < TARGET_EXPOSURES);
    expect(learning.length).toBeLessThanOrEqual(6);
  });

  it('never leaves a turn empty while unseen words remain', () => {
    // A new learner: no familiar words, no review cards. 18 s per word plus the 1.5 s swap, for two hours.
    const big = Array.from({ length: 150 }, (_, i) => `n${i}`);
    const { empty, exposure } = simulate(370, 19.5 / 60, { pool: big, rand: seq(0.9, 0.3, 0.05, 0.6, 0.41, 0.95, 0.2) });
    expect(Object.keys(exposure).length).toBeLessThan(big.length);
    expect(empty).toBe(0);
  });

  it('does not repeat a word within the recent window when alternatives exist', () => {
    const { shown } = simulate(200, 1 / 3, { pool: Array.from({ length: 300 }, (_, i) => `w${i}`) });
    for (let i = 5; i < shown.length; i++) expect(shown.slice(i - 5, i)).not.toContain(shown[i]);
  });

  it('graduates words after enough exposures and keeps bringing in new ones', () => {
    const { exposure } = simulate(400);
    const graduated = Object.values(exposure).filter((e) => e.n >= TARGET_EXPOSURES).length;
    expect(graduated).toBeGreaterThan(10);
  });

  it('never shows a learning word before its gap, so a word needs at least 32 minutes to become familiar', () => {
    // 18 s per word, every roll mixed in; long enough for many words to graduate.
    const rolls = seq(0.9, 0.3, 0.05, 0.6, 0.41, 0.95, 0.2);
    const { log } = simulate(1200, 0.3, { rand: rolls, due: ['w29'] });
    const firstShown = new Map<string, number>();
    let graduated = 0;
    for (const { id, at, before } of log) {
      if (!before) { firstShown.set(id, at); continue; }
      if (before.n < TARGET_EXPOSURES) expect(at - before.t, `${id} shown again after ${before.n}`).toBeGreaterThanOrEqual(GAP_MIN[before.n] - 1e-9);
      if (before.n === TARGET_EXPOSURES - 1) {
        graduated++;
        expect(at - firstShown.get(id)!, `${id} became familiar`).toBeGreaterThanOrEqual(32 - 1e-9);
      }
    }
    expect(graduated).toBeGreaterThan(10);
  });

  it('with no learning word due, fills the turn with a familiar word or a due card instead of an early repeat', () => {
    const exposure: Record<string, Exposure> = {
      w0: { n: 2, t: 99 }, w1: { n: 9, t: 10 },
      ...Object.fromEntries(pool.slice(2).map((id) => [id, { n: 1, t: 99.5 }])),
    };
    // Six learning words, none due at minute 100 (gaps 3 and 1): the batch is full.
    const small = pool.slice(0, 8);
    const p = pickNext({ pool: small, exposure, due: [], recent: [], now: 100, rand: seq(0.9), batchSize: 7 });
    expect(p).toEqual({ id: 'w1', reason: 'familiar' });
    const q = pickNext({ pool: small, exposure, due: ['w20'], recent: ['w1'], now: 100, rand: seq(0.9), batchSize: 7 });
    expect(q).toEqual({ id: 'w20', reason: 'due' });
    expect(pickNext({ pool: small, exposure, due: [], recent: ['w1'], now: 100, rand: seq(0.9), batchSize: 7 })).toBeNull();
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
