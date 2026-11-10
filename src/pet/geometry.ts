// Pet window placement. Positions are physical pixels; sizes ending in Css are CSS pixels.

export interface Rect { x: number; y: number; w: number; h: number }
/** Screen side she stands on; she faces the other way and the bubble leans toward the middle. */
export interface Anchor { h: 'left' | 'right' }
export interface Size { w: number; h: number }

/** Height an ordinary bubble needs; taller bubbles grow it (see Pet.svelte). */
export const BASE_BUBBLE_ROOM = 250;
/** Room kept around the bubble for its shadow, CSS px: the window clips anything drawn past its edge,
 * so the pet's shadow (Pet.svelte --pet-shadow) must stay inside this margin. */
export const SHADOW_PAD = 14;
/** Bubble width (264) plus the shadow margin on its far side, CSS px. */
const BUBBLE_W = 280;
/** Her eyes sit this far down the frame; the bubble's tail points at them. */
const EYES = 0.12;
/** The tail is a rotated 16 px square. */
const TAIL = 16;
/** The bubble's tail reaches this far past the bubble's side toward her (Bubble.svelte .tail). */
export const TAIL_REACH = 11;
/** The tail tip sits this far inside the sprite frame, as a fraction of the frame's width: standing, she fills the
 * middle of the frame, and a bubble kept outside it looked detached from her. Her raised hand crosses the tip while she
 * waves. */
export const FRAME_OVERLAP = 0.1;
const bubbleSide = (sprite: Size) => Math.round(sprite.w * (1 - FRAME_OVERLAP) + TAIL_REACH);

/** Window size in CSS px: the sprite with the bubble beside her, toward the middle of the screen. */
export function windowSize(sprite: Size, room = BASE_BUBBLE_ROOM): Size {
  return { w: bubbleSide(sprite) + BUBBLE_W, h: Math.round(Math.max(sprite.h, room)) };
}

/** Where the bubble sits (CSS px from the window's anchor side and top): its top level with her head,
 * moved up only as far as a tall bubble needs to fit, with the shadow margin kept on every side.
 * `tail` is the tail's offset from the bubble's top, so it points at her eyes even when the bubble rose. */
export function bubbleInset(win: Size, sprite: Size, room = BASE_BUBBLE_ROOM) {
  const spriteTop = win.h - sprite.h;
  const headTop = spriteTop + sprite.h * 0.03;
  const top = Math.round(Math.max(SHADOW_PAD, Math.min(headTop, win.h - room + SHADOW_PAD)));
  const tail = Math.round(Math.max(12, spriteTop + sprite.h * EYES - TAIL / 2 - top));
  return { side: bubbleSide(sprite), top, tail };
}

/** Where the sprite sits inside the window (CSS px). */
export function spriteOffset(anchor: Anchor, win: Size, sprite: Size) {
  return {
    x: anchor.h === 'right' ? win.w - sprite.w : 0,
    y: win.h - sprite.h,
  };
}

/** Where she stands: the sprite's left edge and its feet, physical px. Placement is saved as this rather than the
 * window's top-left, because the window's height follows the bubble and her feet must stay on the taskbar. */
export interface Spot { x: number; bottom: number }

export function spotOf(windowPos: { x: number; y: number }, scale: number, winCss: Size, spriteCss: Size, anchor: Anchor): Spot {
  const off = spriteOffset(anchor, winCss, spriteCss);
  return { x: windowPos.x + off.x * scale, bottom: windowPos.y + (off.y + spriteCss.h) * scale };
}

/** The window position that puts the sprite at `spot` with the current window size. */
export function windowAt(spot: Spot, scale: number, winCss: Size, spriteCss: Size, anchor: Anchor) {
  const off = spriteOffset(anchor, winCss, spriteCss);
  return { x: Math.round(spot.x - off.x * scale), y: Math.round(spot.bottom - (off.y + spriteCss.h) * scale) };
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
 * Keeps the sprite where it was dropped, snaps it to a nearby work-area edge, clamps it so the
 * whole window (a tall bubble may rise above her head) stays on screen, and recomputes the anchor. Idempotent, so reacting to
 * its own move event cannot loop.
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
