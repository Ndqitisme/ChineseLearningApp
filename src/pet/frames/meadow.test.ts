import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SWAY_MAX } from './leaves.ts';
import { BRUSH_REACH, BUBBLE_W, MEADOW, atlasScale, boxHeight, boxWidth, brushWeights, hitBox, pivot, shearDeg, shearedOutline, swayLeaves } from './meadow.ts';
import { PLAIN_PAD, skinPad } from '../skins.ts';

describe('meadow sprites', () => {
  const W = boxWidth(MEADOW.pad);

  it(`every sprite, leaning up to ${SWAY_MAX}° times its bend either way, stays inside the window`, () => {
    const bad: string[] = [];
    // Frame box heights from a short bubble below the window's 250px minimum up to a tall one.
    for (const h of [200, 250, 300, 380, 460]) for (const s of MEADOW.sprites) for (const sign of [-1, 0, 1]) {
      const skew = shearDeg(sign * SWAY_MAX, s.bend);
      for (const [x, y] of shearedOutline(s, { w: W, h }, skew)) {
        if (x < -0.01 || y < -0.01 || x > W + 0.01 || y > h + 0.01) {
          bad.push(`${s.id} h ${h} skew ${skew.toFixed(1)}: ${x.toFixed(1)},${y.toFixed(1)}`);
          break;
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('every sprite is well formed and sways by a share between 0 and 1', () => {
    expect(MEADOW.sprites.length).toBeGreaterThan(0);
    expect(new Set(MEADOW.sprites.map((s) => s.id)).size).toBe(MEADOW.sprites.length);
    for (const s of MEADOW.sprites) {
      expect([0, 1], s.id).toContain(s.ax);
      expect([0, 1], s.id).toContain(s.ay);
      expect(s.w > 0 && s.h > 0, s.id).toBe(true);
      expect(s.bend >= 0 && s.bend <= 1, s.id).toBe(true);
      expect(s.px >= 0 && s.px <= s.w && s.py >= 0 && s.py <= s.h, `${s.id} pivot inside the sprite`).toBe(true);
    }
  });

  it('every source rect lies inside the atlas at every scale', () => {
    for (const scale of MEADOW.scales) {
      const png = readFileSync(new URL(`./meadow@${scale}x.png`, import.meta.url));
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
      expect([w, h], `@${scale}x size`).toEqual([MEADOW.atlas.w * scale, MEADOW.atlas.h * scale]);
      for (const { id, src } of MEADOW.sprites) {
        const ok = src.x >= 0 && src.y >= 0 && src.w > 0 && src.h > 0 && (src.x + src.w) * scale <= w && (src.y + src.h) * scale <= h;
        expect(ok, `${id} @${scale}x`).toBe(true);
      }
    }
  });
});

describe('meadow pointer', () => {
  const box = { w: boxWidth(MEADOW.pad), h: 300 };

  it('takes the pointer only over the visible part of each plant, inside its sprite', () => {
    for (const s of MEADOW.sprites) {
      const b = hitBox(s);
      expect(b.w > 0 && b.h > 0, s.id).toBe(true);
      expect(b.x >= s.x - 0.01 && b.y >= s.y - 0.01 && b.x + b.w <= s.x + s.w + 0.01 && b.y + b.h <= s.y + s.h + 0.01, s.id).toBe(true);
    }
  });

  it('brushes a plant fully when the pointer is over its middle, and not at all far from it', () => {
    const s = MEADOW.sprites[0], b = hitBox(s);
    const cx = s.ax * box.w + b.x + b.w / 2, cy = s.ay * box.h + b.y + b.h / 2;
    expect(brushWeights(MEADOW.sprites, box, cx, cy)[0]).toBeCloseTo(1, 5);
    expect(brushWeights(MEADOW.sprites, box, cx + b.w / 2 + BRUSH_REACH + 1, cy)[0]).toBe(0);
    expect(brushWeights(MEADOW.sprites, box, cx, s.ay * box.h + b.y - BRUSH_REACH - 1)[0]).toBe(0);
    // High above the bed, over the bubble, no plant is touched.
    expect(brushWeights(MEADOW.sprites, box, box.w / 2, 20).every((w) => w === 0)).toBe(true);
  });
});

describe('meadow geometry', () => {
  it('sizes the window from the bubble and the margin', () => {
    const pad = { top: 16, side: 28, bottom: 48 };
    expect(boxWidth(pad)).toBe(BUBBLE_W + 56);
    expect(boxHeight(pad, 200)).toBe(264);
    expect(boxWidth(PLAIN_PAD)).toBe(292);
    expect(boxHeight(PLAIN_PAD, 200)).toBe(228);
  });

  it('gives the leaf skin the meadow margin and the plain bubble its shadow margin', () => {
    expect(skinPad('leaf')).toEqual(MEADOW.pad);
    expect(skinPad(undefined)).toEqual({ top: 14, side: 14, bottom: 14 });
    expect(skinPad('assistant')).toEqual(PLAIN_PAD);
  });

  it('picks the next whole atlas scale up for the pixel ratio', () => {
    expect([0.5, 1, 1.25, 1.5, 2, 2.5, 3, 4, NaN].map((d) => atlasScale(d, [1, 2, 3]))).toEqual([1, 1, 2, 2, 2, 3, 3, 3, 1]);
    expect(atlasScale(3, [1, 2])).toBe(2);
  });

  it('springs each sprite upright from its base, as long as it is tall', () => {
    const leaves = swayLeaves(MEADOW.sprites);
    MEADOW.sprites.forEach((s, i) => {
      expect(leaves[i]).toMatchObject({ ax: s.ax, ay: s.ay, ...pivot(s), angle: -90, length: s.h });
    });
  });

  it('leans the top the way the spring turns and keeps the base put', () => {
    const s = { ...MEADOW.sprites[0], x: 10, y: -40, w: 20, h: 40, px: 10, py: 40, bend: 0.5 };
    const [tl, , bl] = shearedOutline({ ...s, hull: undefined }, { w: 300, h: 200 }, shearDeg(20, s.bend));
    expect(tl[0]).toBeGreaterThan(10);
    expect(bl[0]).toBeCloseTo(10);
    expect(bl[1]).toBe(200);
  });
});
