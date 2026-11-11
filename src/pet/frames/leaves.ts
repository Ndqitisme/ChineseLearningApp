// What a swaying part of a border skin is to sway.ts.

/** How far a part may turn either way from rest; a sprite takes its `bend` share of this (meadow.ts). */
export const SWAY_MAX = 25;

export interface Leaf {
  /** Anchor on the frame box as fractions of its width and height (0 or 1). */
  ax: number;
  ay: number;
  /** Pivot: px offset from the anchor. */
  x: number;
  y: number;
  /** Rest angle in degrees, clockwise from pointing right. */
  angle: number;
  /** Pivot to tip, px. */
  length: number;
}
