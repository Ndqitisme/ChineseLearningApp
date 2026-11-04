// Pet window placement. Positions are physical pixels; sizes ending in Css are CSS pixels.

export interface Rect { x: number; y: number; w: number; h: number }
/** Screen side she stands on; she faces the other way and the bubble leans toward the middle. */
export interface Anchor { h: 'left' | 'right' }
export interface Size { w: number; h: number }

/** Room above the sprite for an ordinary bubble; taller bubbles grow it (see Pet.svelte). */
export const BASE_BUBBLE_ROOM = 250;

/** Window size in CSS px: the sprite plus room for the bubble, which is always above her head. */
export function windowSize(sprite: Size, room = BASE_BUBBLE_ROOM): Size {
  return { w: Math.round(Math.max(300, 270 + sprite.w * 0.45)), h: Math.round(sprite.h + room) };
}

/** Where the sprite sits inside the window (CSS px). */
export function spriteOffset(anchor: Anchor, win: Size, sprite: Size) {
  return {
    x: anchor.h === 'right' ? win.w - sprite.w : 0,
    y: win.h - sprite.h,
  };
}

export function anchorFor(sprite: Rect, workArea: Rect): Anchor {
  return { h: sprite.x + sprite.w / 2 > workArea.x + workArea.w / 2 ? 'right' : 'left' };
}

export interface SnapInput {
  windowPos: { x: number; y: number };
  scale: number;              // device pixel ratio of the monitor
  winCss: Size;
  spriteCss: Size;
  anchor: Anchor;             // anchor the window currently uses
  workArea: Rect;
  snapDistanceCss?: number;
}

/**
 * Keeps the sprite where the user dropped it, snaps it to a nearby work-area edge, clamps it
 * on screen with room above her for the bubble, and recomputes the anchor. Idempotent: snapping
 * a snapped result returns the same position, so reacting to our own move events cannot loop.
 */
export function snap(input: SnapInput): { pos: { x: number; y: number }; anchor: Anchor } {
  const { scale, winCss, spriteCss, workArea } = input;
  const snapDist = (input.snapDistanceCss ?? 48) * scale;
  const sw = spriteCss.w * scale, sh = spriteCss.h * scale;
  const off = spriteOffset(input.anchor, winCss, spriteCss);
  let sx = input.windowPos.x + off.x * scale;
  let sy = input.windowPos.y + off.y * scale;

  const left = workArea.x, top = workArea.y + (winCss.h - spriteCss.h) * scale;
  const right = workArea.x + workArea.w - sw, bottom = workArea.y + workArea.h - sh;
  if (sx - left < snapDist) sx = left;
  if (right - sx < snapDist) sx = right;
  if (sy - top < snapDist) sy = top;
  if (bottom - sy < snapDist) sy = bottom;
  sx = Math.min(Math.max(sx, left), right);
  sy = Math.min(Math.max(sy, top), bottom);

  const anchor = anchorFor({ x: sx, y: sy, w: sw, h: sh }, workArea);
  const newOff = spriteOffset(anchor, winCss, spriteCss);
  return {
    pos: { x: Math.round(sx - newOff.x * scale), y: Math.round(sy - newOff.y * scale) },
    anchor,
  };
}

/** Default spot: standing on the taskbar in the bottom-right corner, against the screen edge. */
export function defaultPlacement(workArea: Rect, scale: number, winCss: Size, spriteCss: Size) {
  const anchor: Anchor = { h: 'right' };
  const pos = {
    x: workArea.x + workArea.w - winCss.w * scale,
    y: workArea.y + workArea.h - winCss.h * scale,
  };
  return snap({ windowPos: pos, scale, winCss, spriteCss, anchor, workArea, snapDistanceCss: 0 });
}
