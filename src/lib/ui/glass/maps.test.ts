import { describe, expect, it } from 'vitest';
import { _rays, mapPixels } from './maps.ts';

describe('glass ray table', () => {
  it('convex bezel bends every ray inward and is flat at the interior end', () => {
    const t = _rays('convex', 16);
    expect(t.max).toBeGreaterThan(0.5);
    for (const d of t.mag) expect(d).toBeGreaterThanOrEqual(0);
    expect(Math.abs(t.mag[t.mag.length - 1])).toBeLessThan(t.max * 0.02);
    expect(t.mag[0]).toBeLessThan(t.max);
  });

  it('the maximum displacement never exceeds the bezel width', () => {
    for (const bezel of [8, 16, 28]) expect(_rays('convex', bezel).max).toBeLessThan(bezel);
  });

  it('convex sampling moves inward monotonically, also at the hover bend (×1.2): the backdrop never folds', () => {
    for (const bezel of [9, 16, 24, 32]) {
      const t = _rays('convex', bezel);
      const step = bezel / (t.mag.length - 1);
      for (let i = 1; i < t.mag.length; i++) expect(step + 1.2 * (t.mag[i] - t.mag[i - 1])).toBeGreaterThan(0);
    }
  });

  it('the drawn displacement, scale × (R/255 − 0.5) as feDisplacementMap applies it, equals the ray table and never folds', () => {
    for (const [w, h, r, bezel] of [[144, 37, 18.5, 18.5], [196, 544, 14, 16], [590, 300, 20, 20], [60, 60, 30, 30], [44, 24, 12, 12]]) {
      const { D, scale } = mapPixels(w, h, r, bezel, 'convex');
      const t = _rays('convex', bezel);
      const drawn = (px: number, py: number, c: number) => scale * (D[(py * w + px) * 4 + c] / 255 - 0.5);
      const level = scale / 255;
      // Into the glass from the left cap at mid-height and from the top edge at mid-width.
      for (const [n, at] of [[w >> 1, (i: number) => drawn(i, h >> 1, 0)], [h >> 1, (i: number) => drawn(w >> 1, i, 1)]] as const) {
        // Pixel centres sample the peak of the ray table to within about a quarter px.
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, at(i));
        expect(Math.abs(peak - t.max), `${w}x${h} peak ${peak.toFixed(2)} vs ${t.max.toFixed(2)}`).toBeLessThan(2 * level + 0.3);
        for (const k of [1, 1.2]) for (let i = 1; i < n; i++) expect(1 + k * (at(i) - at(i - 1)), `${w}x${h} k${k} px ${i}`).toBeGreaterThan(0);
      }
    }
  });

  it('past the bezel band the displacement is exactly neutral (128,128): one level would wave a 1px line', () => {
    for (const [w, h, r, bezel] of [[196, 544, 14, 16], [288, 169, 18, 18], [590, 300, 20, 20], [144, 37, 18.5, 18.5]]) {
      const { D } = mapPixels(w, h, r, bezel, 'convex');
      let off = 0;
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        if (Math.min(px, py, w - 1 - px, h - 1 - py) < bezel + 1) continue;
        const o = (py * w + px) * 4;
        if (D[o] !== 128 || D[o + 1] !== 128) off++;
      }
      expect(off, `${w}x${h} r${r} bezel ${bezel}`).toBe(0);
    }
  });

  it('edges facing away from the light (bottom, right) carry no specular: a faint rim there reads as a reversed band on dark', () => {
    for (const [w, h, r, bezel] of [[146, 40, 10, 16], [144, 37, 18.5, 18.5]]) {
      const { S } = mapPixels(w, h, r, bezel, 'convex');
      const alpha = (px: number, py: number) => S[(py * w + px) * 4 + 3];
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
      for (let d = 0; d < 6; d++) {
        expect(alpha(cx, h - 1 - d), `${w}x${h} bottom row ${d}`).toBe(0);
        expect(alpha(w - 1 - d, cy), `${w}x${h} right column ${d}`).toBe(0);
      }
      expect(alpha(cx, 0)).toBeGreaterThan(0);
      expect(alpha(0, cy)).toBeGreaterThan(0);
    }
  });

  it('lip profile pushes rays outward in its dip', () => {
    const t = _rays('lip', 11);
    expect(Math.min(...t.mag)).toBeLessThan(0);
    expect(Math.max(...t.mag)).toBeGreaterThan(0);
  });
});
