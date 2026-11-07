import { describe, expect, it } from 'vitest';
import { toSyllables } from './pinyin.ts';
import { acceptedTones, scoreTones } from './tones.ts';

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

describe('acceptedTones', () => {
  const accepted = (hanzi: string, ...py: string[]) => acceptedTones(hanzi, toSyllables(py));

  it('accepts bú for 不 before a 4th tone, and only bù elsewhere', () => {
    expect(accepted('不对', 'bù', 'duì')).toEqual([[2, 4], [4]]);
    expect(accepted('不好', 'bù', 'hǎo')).toEqual([[4], [3]]);
    // Written with the spoken tone: the citation tone is right too.
    expect(accepted('不是', 'bú', 'shì')).toEqual([[2, 4], [4]]);
  });

  it('accepts yì before tones 1–3 and yí before a 4th or neutral tone', () => {
    expect(accepted('一起', 'yī', 'qǐ')).toEqual([[1, 4], [3]]);
    expect(accepted('一样', 'yī', 'yàng')).toEqual([[1, 2], [4]]);
    expect(accepted('一个', 'yī', 'ge')).toEqual([[1, 2], [5]]);
    expect(accepted('一样', 'yí', 'yàng')).toEqual([[1, 2], [4]]);
    expect(accepted('第一', 'dì', 'yī')).toEqual([[4], [1]]);
  });

  it('accepts a 2nd tone for a 3rd tone before another 3rd', () => {
    expect(accepted('你好', 'nǐ', 'hǎo')).toEqual([[2, 3], [3]]);
    expect(accepted('可以', 'kě', 'yǐ')).toEqual([[2, 3], [3]]);
    expect(accepted('很好', 'hěn', 'hǎo')).toEqual([[2, 3], [3]]);
    expect(accepted('米饭', 'mǐ', 'fàn')).toEqual([[3], [4]]);
  });

  it('leaves syllables alone when characters and syllables do not line up', () => {
    expect(accepted('一点儿', 'yī', 'diǎnr')).toEqual([[1], [3]]);
  });
});
