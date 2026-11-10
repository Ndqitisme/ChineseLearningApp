import { describe, expect, it } from 'vitest';
import { BASE_BUBBLE_ROOM, HAND_CLEAR, SHADOW_PAD, TAIL_REACH, bubbleInset, defaultPlacement, snap, spotOf, spriteOffset, windowAt, windowSize, type Anchor } from './geometry.ts';

const workArea = { x: 0, y: 0, w: 1920, h: 1040 };
const spriteCss = { w: 115, h: 210 };
const winCss = { w: 300, h: 460 };

function snapAt(x: number, y: number, anchor: Anchor = { h: 'right' }, scale = 1) {
  return snap({ windowPos: { x, y }, scale, winCss, spriteCss, anchor, workArea });
}

describe('snap', () => {
  it('dragged to the top, she stops low enough for the bubble above her head to stay on screen', () => {
    for (const scale of [1, 1.5]) {
      const r = snapAt(900, -400, { h: 'left' }, scale);
      const spriteTop = r.pos.y + spriteOffset(r.anchor, winCss, spriteCss).y * scale;
      expect(r.pos.y).toBeGreaterThanOrEqual(workArea.y);
      expect(spriteTop).toBeGreaterThanOrEqual(workArea.y + (winCss.h - spriteCss.h) * scale);
    }
  });

  it('puts the sprite flush against the right edge when dropped near it', () => {
    const r = snapAt(1920 - 300 - 20, 500);
    const off = spriteOffset(r.anchor, winCss, spriteCss);
    expect(r.anchor.h).toBe('right');
    expect(r.pos.x + off.x + spriteCss.w).toBe(workArea.x + workArea.w);
  });

  it('bubble-only mode (zero-height sprite strip as wide as the window) stays on screen and hugs the edge', () => {
    const win = { w: 290, h: 260 }, strip = { w: 290, h: 0 };
    const top = snap({ windowPos: { x: 900, y: -300 }, scale: 1, winCss: win, spriteCss: strip, anchor: { h: 'left' }, workArea });
    expect(top.pos.y).toBe(workArea.y);
    const right = snap({ windowPos: { x: 1600, y: 700 }, scale: 1, winCss: win, spriteCss: strip, anchor: { h: 'right' }, workArea });
    expect(right.pos.x + win.w).toBe(workArea.x + workArea.w);
    const again = snap({ windowPos: right.pos, scale: 1, winCss: win, spriteCss: strip, anchor: right.anchor, workArea });
    expect(again).toEqual(right);
  });

  it('is idempotent, so reacting to its own move event cannot loop', () => {
    for (const [x, y] of [[900, -400], [1700, 500], [10, 900], [960, 300]]) {
      const once = snapAt(x, y, { h: x > 960 ? 'right' : 'left' }, 1.25);
      const twice = snap({ windowPos: once.pos, scale: 1.25, winCss, spriteCss, anchor: once.anchor, workArea });
      expect(twice).toEqual(once);
    }
  });
});

describe('bubbleInset', () => {
  // Every pet size (frame 139x340 scaled to 160/210/270 px tall), short and tall bubbles.
  const sprites = [160, 210, 270].map((h) => ({ w: Math.round((139 * h) / 340), h }));
  const bubbleHeights = [150, 222, 300, 420];

  it('keeps the shadow margin around the bubble inside the window', () => {
    for (const sprite of sprites) for (const bh of bubbleHeights) {
      const room = Math.max(BASE_BUBBLE_ROOM, bh + 2 * SHADOW_PAD);
      const win = windowSize(sprite, room);
      const { side, top } = bubbleInset(win, sprite, room);
      expect(top, `top, sprite ${sprite.h}, bubble ${bh}`).toBeGreaterThanOrEqual(SHADOW_PAD);
      expect(win.h - (top + bh), `bottom, sprite ${sprite.h}, bubble ${bh}`).toBeGreaterThanOrEqual(SHADOW_PAD);
      expect(win.w - side - 264, `far side, sprite ${sprite.h}`).toBeGreaterThanOrEqual(SHADOW_PAD);
    }
  });

  it('keeps the tail tip clear of the sprite frame, which her waving hand reaches, at every size', () => {
    for (const sprite of sprites) {
      const { side } = bubbleInset(windowSize(sprite), sprite);
      expect(side - TAIL_REACH - sprite.w, `sprite ${sprite.h}`).toBeGreaterThanOrEqual(HAND_CLEAR);
    }
  });

  it('points the tail at her eyes, also when a tall bubble rises above her head', () => {
    for (const sprite of sprites) for (const bh of bubbleHeights) {
      const room = Math.max(BASE_BUBBLE_ROOM, bh + 2 * SHADOW_PAD);
      const win = windowSize(sprite, room);
      const { top, tail } = bubbleInset(win, sprite, room);
      const eyes = win.h - sprite.h + sprite.h * 0.12;
      const tailMid = top + tail + 8;
      if (eyes - top >= 20) expect(Math.abs(tailMid - eyes), `sprite ${sprite.h}, bubble ${bh}`).toBeLessThanOrEqual(1);
      else expect(tail).toBe(12);
    }
  });
});

describe('saved placement', () => {
  it('keeps her feet on the taskbar when the window comes back with another height', () => {
    for (const scale of [1, 1.25, 1.5]) {
      // Saved while a tall bubble made the window 460 px high, standing on the taskbar.
      const tall = { w: 300, h: 460 };
      const placed = defaultPlacement(workArea, scale, tall, spriteCss);
      const saved = spotOf(placed.pos, scale, tall, spriteCss, placed.anchor);
      expect(saved.bottom).toBe(workArea.y + workArea.h);
      // Restored with the base bubble: a shorter window.
      const short = windowSize(spriteCss, BASE_BUBBLE_ROOM);
      const pos = windowAt(saved, scale, short, spriteCss, placed.anchor);
      const r = snap({ windowPos: pos, scale, winCss: short, spriteCss, anchor: placed.anchor, workArea });
      const feet = spotOf(r.pos, scale, short, spriteCss, r.anchor);
      expect(Math.abs(feet.bottom - (workArea.y + workArea.h)), `scale ${scale}`).toBeLessThanOrEqual(1);
      expect(Math.abs(feet.x - saved.x), `scale ${scale}`).toBeLessThanOrEqual(1);
    }
  });
});
