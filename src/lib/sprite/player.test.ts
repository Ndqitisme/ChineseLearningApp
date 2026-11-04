import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpritePlayer } from './Sprite.svelte';
import type { Skin } from './skins.ts';

const skin = { animations: {
  idle: [[0, 0]], wave: [[1, 75], [2, 75], [1, 75], [0, 0]],
  sleep: [[3, 100], [4, 100], [5, 0]], drag: [[6, 65], [7, 65], [8, 0]],
} } as Skin;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('holds the drag pose, then lowers the leg through the entry frames on release', () => {
  const player = new SpritePlayer(); player.setSkin(skin); player.play('drag');
  vi.runAllTimers(); expect(player.frame).toBe(8); expect(player.current).toBe('drag');
  player.play('idle'); expect(player.frame).toBe(7);
  vi.advanceTimersByTime(120); expect(player.frame).toBe(6);
  vi.runAllTimers(); expect(player.frame).toBe(0); expect(player.current).toBe('idle');
});

it('wakes up through intermediate poses before beginning a wave', () => {
  const player = new SpritePlayer(); player.setSkin(skin); player.play('sleep');
  vi.runAllTimers(); expect(player.frame).toBe(5);
  player.play('wave'); expect(player.frame).toBe(4);
  vi.advanceTimersByTime(120); expect(player.frame).toBe(3);
  vi.advanceTimersByTime(120); expect(player.frame).toBe(0);
  vi.advanceTimersByTime(120); expect(player.frame).toBe(1);
  vi.runAllTimers(); expect(player.frame).toBe(0); expect(player.current).toBe('idle');
});

it('cancels an interrupted action timer, including during its recovery', () => {
  const player = new SpritePlayer(); player.setSkin(skin); player.play('wave');
  vi.advanceTimersByTime(75); expect(player.frame).toBe(2);
  player.play('sleep'); expect(player.frame).toBe(1);
  player.play('drag');
  vi.runAllTimers(); expect(player.frame).toBe(8); expect(player.current).toBe('drag');
  expect(vi.getTimerCount()).toBe(0);
});
