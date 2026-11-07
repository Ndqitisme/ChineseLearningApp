import { describe, expect, it } from 'vitest';
import type { SrsCardJson } from '../lib/progress.svelte.ts';
import { review, Rating, type Grade } from '../lib/srs.ts';
import { LEARN_AHEAD_MIN, NEW_PER_DAY, newLeft, queueIds } from './review-queue.svelte.ts';

const now = Date.parse('2026-11-07T10:00:00Z');
const card = (dueMin: number) => ({ due: new Date(now + dueMin * 60_000).toISOString() }) as SrsCardJson;
const shown = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`w${i}`, { n: 5, t: i }]));
const all = () => true;

describe('review queue', () => {
  it('lists due cards oldest first, then new words up to what is left for the day', () => {
    const srs = { a: card(-5), b: card(-60), later: card(30) };
    expect(queueIds(srs, shown(15), all, now, 3)).toEqual(['b', 'a', 'w0', 'w1', 'w2']);
    expect(queueIds(srs, shown(15), all, now, 0)).toEqual(['b', 'a']);
    expect(queueIds(srs, shown(15), all, now, -2)).toEqual(['b', 'a']);
  });

  it('caps new cards per day, not per session, and starts again the next day', () => {
    expect(newLeft({ day: '', ids: [] }, '2026-11-07')).toBe(NEW_PER_DAY);
    const seven = { day: '2026-11-07', ids: ['x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6'] };
    expect(newLeft(seven, '2026-11-07')).toBe(3);
    // A second session the same day gets only what is left.
    expect(queueIds({}, shown(15), all, now, newLeft(seven, '2026-11-07'))).toHaveLength(3);
    expect(newLeft(seven, '2026-11-08')).toBe(NEW_PER_DAY);
  });

  it('skips words that are not open and words marked known', () => {
    const exposure = { ...shown(3), w1: { n: 5, t: 1, k: 1 as const } };
    expect(queueIds({ a: card(-1), w0: card(-1) }, exposure, (id) => id !== 'a', now, 10)).toEqual(['w0', 'w2']);
  });

  it('a new card graded Hard or Good is due again within the session window', () => {
    for (const g of [Rating.Hard, Rating.Good] as Grade[]) {
      const c = review(undefined, g, new Date(now));
      expect(Date.parse(c.due) - now, `grade ${g}`).toBeLessThanOrEqual(LEARN_AHEAD_MIN * 60_000);
    }
    expect(Date.parse(review(undefined, Rating.Easy, new Date(now)).due) - now).toBeGreaterThan(LEARN_AHEAD_MIN * 60_000);
  });
});
