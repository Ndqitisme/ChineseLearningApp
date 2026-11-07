import { describe, expect, it } from 'vitest';
import { inQuietWindow, quietWindowEnd } from './quiet.ts';

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);

describe('quiet hours', () => {
  it('handles a window across midnight and one within a day', () => {
    expect([at(7, 22, 29), at(7, 22, 30), at(8, 3), at(8, 6, 59), at(8, 7)].map((d) => inQuietWindow(d, '22:30', '07:00')))
      .toEqual([false, true, true, true, false]);
    expect([at(7, 12, 59), at(7, 13), at(7, 14, 59), at(7, 15)].map((d) => inQuietWindow(d, '13:00', '15:00')))
      .toEqual([false, true, true, false]);
  });

  it('ends at the next "to" time, the same night or the next morning', () => {
    expect(quietWindowEnd(at(7, 23), '07:00')).toBe(at(8, 7).getTime());
    expect(quietWindowEnd(at(8, 3), '07:00')).toBe(at(8, 7).getTime());
    expect(quietWindowEnd(at(7, 13, 30), '15:00')).toBe(at(7, 15).getTime());
  });
});
