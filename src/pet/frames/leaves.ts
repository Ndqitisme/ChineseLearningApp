// Leaves of the border skins, one entry per leaf, each drawn as its own <g> that turns about its pivot. The frame box is
// the bubble plus FRAME_OUT on every side (Pet.svelte .frame); the top and bottom edges have a fixed length, the sides
// follow the bubble's height, so a pivot is an anchor on the box plus a px offset from it.

/** Frame box margin around the bubble, CSS px (Pet.svelte .frame). */
export const FRAME_OUT = 11;
/** How far a leaf may turn either way from its rest angle and stay inside the window (geometry.ts SHADOW_PAD). */
export const SWAY_MAX = 25;

export interface Leaf {
  /** Anchor on the frame box as fractions of its width and height (0, 0.5 or 1). */
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

/** A leaf drawn for the top-left corner, also at the other three corners, mirrored. */
const corners = (l: Omit<Leaf, 'ax' | 'ay'>): Leaf[] => [
  { ...l, ax: 0, ay: 0 },
  { ...l, ax: 1, ay: 0, x: -l.x, angle: 180 - l.angle },
  { ...l, ax: 0, ay: 1, y: -l.y, angle: -l.angle },
  { ...l, ax: 1, ay: 1, x: -l.x, y: -l.y, angle: 180 + l.angle },
];
/** A leaf drawn on the top edge, also on the bottom edge, mirrored. */
const topAndBottom = (l: Omit<Leaf, 'ax' | 'ay'>): Leaf[] => [
  { ...l, ax: 0, ay: 0 },
  { ...l, ax: 0, ay: 1, y: -l.y, angle: -l.angle },
];
/** A leaf drawn at the middle of the left side, also on the right side, mirrored. */
const sides = (l: Omit<Leaf, 'ax' | 'ay'>): Leaf[] => [
  { ...l, ax: 0, ay: 0.5 },
  { ...l, ax: 1, ay: 0.5, x: -l.x, angle: 180 - l.angle },
];

/** Leaf outlines one px long, drawn scaled to `length`, and their widest half-width as a fraction of it. */
export const LEAF_SHAPE = { d: 'M0 0C.275-.35 .7-.4 1 0C.7 .4 .275 .35 0 0Z', halfWidth: 0.28 };
export const BAMBOO_LEAF_SHAPE = { d: 'M0 0C.25-.2 .62-.22 1 0C.62 .22 .25 .2 0 0Z', halfWidth: 0.16 };

/** The vine of the leaf skin runs this far inside the frame box. */
export const VINE = 5.75;

export const LEAF_LEAVES: Leaf[] = [
  // Top and bottom edges: 286px wide, the corner sprays take the first and last 34px.
  ...Array.from({ length: 11 }, (_, i) => i).flatMap((i) => topAndBottom(
    i % 2 === 0 ? { x: 36 + i * 21.4, y: VINE, angle: -30, length: 7 } : { x: 36 + i * 21.4, y: VINE, angle: 22, length: 6 })),
  ...sides({ x: VINE, y: -8, angle: -118, length: 6.5 }),
  ...sides({ x: VINE, y: 0, angle: -62, length: 6 }),
  ...sides({ x: VINE, y: 8, angle: -118, length: 6.5 }),
  ...corners({ x: 12, y: 8, angle: -12, length: 9 }),
  ...corners({ x: 8, y: 12, angle: 102, length: 9 }),
  ...corners({ x: 9, y: 9, angle: -135, length: 6 }),
];

export const BAMBOO_LEAVES: Leaf[] = [
  ...corners({ x: 10, y: 5.5, angle: -4, length: 15 }),
  ...corners({ x: 13, y: 5, angle: -14, length: 11 }),
  ...corners({ x: 5.5, y: 10, angle: 94, length: 15 }),
  ...corners({ x: 5, y: 13, angle: 104, length: 11 }),
].filter((l) => (l.ax === 0) === (l.ay === 0)); // sprays at the top-left and bottom-right corners only
