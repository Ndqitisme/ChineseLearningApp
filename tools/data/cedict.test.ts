import { describe, expect, it } from 'vitest';
import { fullGloss } from './cedict.ts';

describe('fullGloss', () => {
  it('drops whole senses past the limit', () => {
    const senses = Array.from({ length: 10 }, (_, i) => `nghĩa thứ ${i} khá dài để vượt giới hạn`);
    const out = fullGloss(senses);
    expect(out.length).toBeLessThanOrEqual(220);
    expect(senses.join('; ').startsWith(out + ';')).toBe(true);
  });

  it('cuts a single long sense at a word', () => {
    const sense = Array.from({ length: 60 }, (_, i) => `từ${i}`).join(' ');
    const out = fullGloss([sense]);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(221);
    expect(sense.startsWith(out.slice(0, -1) + ' ')).toBe(true);
  });
});
