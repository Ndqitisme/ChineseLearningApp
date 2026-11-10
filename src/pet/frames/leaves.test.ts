import { describe, expect, it } from 'vitest';
import { SHADOW_PAD } from '../geometry.ts';
import { BAMBOO_LEAF_SHAPE, BAMBOO_LEAVES, FRAME_OUT, LEAF_LEAVES, LEAF_SHAPE, SWAY_MAX, type Leaf } from './leaves.ts';

const W = 264 + 2 * FRAME_OUT;
/** The smallest theme corner radius leaves the least room at the bubble's corners. */
const RADIUS = 14;
/** A leaf may cross the bubble's 2px ring, never further in. */
const RING = 2;
const STROKE = 0.5;

/** How far point (x, y) is inside the rounded rect [x0, x1] × [y0, y1] with corner radius r; negative outside. */
function depthInRoundedRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (cx === x || cy === y) return Math.min(x - x0, x1 - x, y - y0, y1 - y);
  return r - Math.hypot(x - cx, y - cy);
}

/** Outline points of a leaf turned `turn` degrees from rest, in frame box px. */
function outline(l: Leaf, halfWidth: number, h: number, turn: number) {
  const a = ((l.angle + turn) * Math.PI) / 180, px = l.ax * W + l.x, py = l.ay * h + l.y;
  const out: [number, number][] = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const w = halfWidth * l.length * Math.sin(Math.PI * t) + STROKE, along = t * l.length;
    for (const side of [-1, 1]) out.push([px + Math.cos(a) * along - Math.sin(a) * w * side, py + Math.sin(a) * along + Math.cos(a) * w * side]);
  }
  return out;
}

describe('border skin leaves', () => {
  for (const [name, leaves, shape] of [['leaf', LEAF_LEAVES, LEAF_SHAPE], ['bamboo', BAMBOO_LEAVES, BAMBOO_LEAF_SHAPE]] as const) {
    it(`${name}: every leaf, turned up to ${SWAY_MAX}° either way, stays inside the window and off the bubble's face`, () => {
      const pad = SHADOW_PAD - FRAME_OUT;
      const bad: string[] = [];
      for (const h of [200, 260, 420]) for (const l of leaves) for (let turn = -SWAY_MAX; turn <= SWAY_MAX; turn += 1) {
        for (const [x, y] of outline(l, shape.halfWidth, h, turn)) {
          const outside = x < -pad || y < -pad || x > W + pad || y > h + pad;
          const onFace = depthInRoundedRect(x, y, FRAME_OUT, FRAME_OUT, W - FRAME_OUT, h - FRAME_OUT, RADIUS) > RING;
          if (outside || onFace) { bad.push(`${JSON.stringify(l)} turn ${turn} h ${h}: ${outside ? 'outside the window' : 'on the bubble'} at ${x.toFixed(1)},${y.toFixed(1)}`); break; }
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
    });
  }
});
