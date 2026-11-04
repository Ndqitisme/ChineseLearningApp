import { describe, expect, it } from 'vitest';
import { snap, spriteOffset, type Anchor } from './geometry.ts';

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
