// The flower border of the leaf skin: a low bed of flowers and leaves along the bottom of the bubble, taller leafy
// stems at the bottom corners. Each sprite is cut from a pre-rendered atlas (tools/skins/meadow/) described by
// meadow.json; this file holds its types and the pure geometry the frame and its tests share.

import data from './meadow.json';
import type { Leaf } from './leaves.ts';

/** Window margin around the 264px bubble, CSS px. */
export interface Pad { top: number; side: number; bottom: number }

export interface Rect { x: number; y: number; w: number; h: number }

export interface MeadowSprite {
  id: string;
  kind: 'grass' | 'flower' | 'bush' | 'sprig';
  /** Anchor corner of the frame box: 0, 0 is top-left, 1, 1 bottom-right. */
  ax: 0 | 1;
  ay: 0 | 1;
  /** Drawn top-left as an offset from the anchor, and drawn size, CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the stems meet the ground, inside the drawn sprite; the sprite leans about it. */
  px: number;
  py: number;
  /** Rect in the @1x atlas. */
  src: Rect;
  /** Drawn flipped horizontally. */
  mirror: boolean;
  /** Share of the sway this sprite takes: flowers move most, bushes least. */
  bend: number;
  /** Convex outline of the visible pixels, sprite px; the leaning check uses it instead of the box corners. */
  hull?: [number, number][];
}

export interface Meadow {
  pad: Pad;
  scales: number[];
  atlas: { w: number; h: number };
  sprites: MeadowSprite[];
}

export const MEADOW = data as Meadow;

export const BUBBLE_W = 264;

/** A typical plant's height, px: it sways at the base frequency (sway.ts), taller plants a little slower. */
export const SWAY_REF = 50;

/** Atlas scale for a device pixel ratio: the next whole scale up, within the scales that exist. */
export function atlasScale(dpr: number, scales: readonly number[] = MEADOW.scales): number {
  const want = Math.min(Math.max(Math.ceil(Number.isFinite(dpr) ? dpr : 1), 1), 3);
  const sorted = [...scales].sort((a, b) => a - b);
  return sorted.find((s) => s >= want) ?? sorted[sorted.length - 1];
}

/** Window width of a bubble with this margin. */
export const boxWidth = (pad: Pad) => BUBBLE_W + 2 * pad.side;

/** Window height the bubble needs with this margin. */
export const boxHeight = (pad: Pad, bubbleHeight: number) => bubbleHeight + pad.top + pad.bottom;

/** Pivot of a sprite as an offset from its anchor corner. */
export const pivot = (s: MeadowSprite) => ({ x: s.x + s.px, y: s.y + s.py });

/** One sway spring per sprite: upright, as long as the sprite is tall, timed by its place along the box. */
export const swayLeaves = (sprites: readonly MeadowSprite[]): Leaf[] =>
  sprites.map((s) => ({ ax: s.ax, ay: s.ay, ...pivot(s), angle: -90, length: Math.max(1, s.h) }));

/** SVG skewX angle for a sway turn (deg, clockwise positive): skewX leans the part above the pivot the other way. */
export const shearDeg = (turn: number, bend: number) => -turn * bend;

/** Transform about the sprite's pivot, in its anchor's frame: the base stays put and the top leans. */
export function shearAbout(s: MeadowSprite, turn: number): string {
  const p = pivot(s);
  return `translate(${p.x} ${p.y}) skewX(${shearDeg(turn, s.bend).toFixed(2)}) translate(${-p.x} ${-p.y})`;
}

/** The visible part of a sprite (its hull's bounds, or its box) in its anchor's frame: where it takes the pointer. */
export function hitBox(s: MeadowSprite): Rect {
  if (!s.hull?.length) return { x: s.x, y: s.y, w: s.w, h: s.h };
  const xs = s.hull.map(([x]) => (s.mirror ? s.w - x : x)), ys = s.hull.map(([, y]) => y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: s.x + x0, y: s.y + y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** How far past a plant's sides a passing pointer still touches it, px. */
export const BRUSH_REACH = 10;

/** How strongly a pointer at (x, y), frame box px, brushes each sprite: 1 over the middle of its visible part,
 * falling to 0 BRUSH_REACH past its sides, 0 above or below it. */
export function brushWeights(sprites: readonly MeadowSprite[], box: { w: number; h: number }, x: number, y: number): number[] {
  return sprites.map((s) => {
    const b = hitBox(s), ox = s.ax * box.w, oy = s.ay * box.h;
    const top = oy + b.y - BRUSH_REACH, bottom = oy + b.y + b.h + BRUSH_REACH;
    if (y < top || y > bottom) return 0;
    const half = b.w / 2 + BRUSH_REACH;
    return Math.max(0, 1 - Math.abs(x - (ox + b.x + b.w / 2)) / half);
  });
}

/** What the hint panel hands a border skin: the same press, move and release handlers the character has, so a
 * click on the border shows the next word and a press-and-move drags the panel. */
export interface FrameProps {
  ondown?: (e: PointerEvent) => void;
  onmove?: (e: PointerEvent) => void;
  onup?: (e: PointerEvent) => void;
}

/** Placement of the sprite's image in its anchor's frame; a mirrored sprite flips across its own width. */
export const placeTransform = (s: MeadowSprite) =>
  s.mirror ? `translate(${s.x + s.w} ${s.y}) scale(-1 1)` : `translate(${s.x} ${s.y})`;

/** Outline of a sprite (its hull, or its box corners) sheared by `skew` degrees (SVG skewX) about its pivot, in
 * frame box px. */
export function shearedOutline(s: MeadowSprite, box: { w: number; h: number }, skew: number): [number, number][] {
  const ox = s.ax * box.w, oy = s.ay * box.h, p = pivot(s), k = Math.tan((skew * Math.PI) / 180);
  const local: [number, number][] = s.hull?.length ? s.hull : [[0, 0], [s.w, 0], [0, s.h], [s.w, s.h]];
  return local.map(([lx, ly]) => {
    const x = s.mirror ? s.x + s.w - lx : s.x + lx, y = s.y + ly;
    return [ox + x + k * (y - p.y), oy + y] as [number, number];
  });
}
