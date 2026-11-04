import { describe, expect, it } from 'vitest';
import { scoreTones } from './tones.ts';

/** Synthetic pitch track: f(t) for t in [0,1], 40 frames, in Hz around a 200 Hz voice. */
const track = (f: (t: number) => number, frames = 40) => Array.from({ length: frames }, (_, i) => 200 * 2 ** (f(i / (frames - 1)) / 12));

describe('scoreTones', () => {
  it('prefers the matching tone for a rising contour', () => {
    const rising = track((t) => t * 6);
    expect(scoreTones(rising, [2]).score).toBeGreaterThan(scoreTones(rising, [4]).score + 30);
  });

  it('prefers tone 4 for a falling contour', () => {
    const falling = track((t) => 6 - t * 8);
    expect(scoreTones(falling, [4]).score).toBeGreaterThan(scoreTones(falling, [2]).score + 30);
  });

  it('accepts a dipping contour as tone 3 over tone 1', () => {
    const dip = track((t) => (t < 0.5 ? -t * 6 : -3 + (t - 0.5) * 10));
    expect(scoreTones(dip, [3]).score).toBeGreaterThan(scoreTones(dip, [1]).score);
  });

  it('scores each syllable of a two-syllable word separately', () => {
    // rise then fall: tone 2 followed by tone 4
    const riseFall = track((t) => (t < 0.5 ? t * 12 : 6 - (t - 0.5) * 16), 60);
    const r = scoreTones(riseFall, [2, 4]);
    expect(r.perSyllable[0]).toBeGreaterThan(60);
    expect(r.perSyllable[1]).toBeGreaterThan(60);
    expect(scoreTones(riseFall, [4, 2]).score).toBeLessThan(r.score);
  });

  it('ignores unvoiced frames and returns 0 when nothing was voiced', () => {
    expect(scoreTones([null, null, null], [1]).score).toBe(0);
    const withGaps = [null, ...track((t) => t * 6), null];
    expect(scoreTones(withGaps, [2]).score).toBeGreaterThan(60);
  });
});
