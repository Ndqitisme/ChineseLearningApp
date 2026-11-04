import { describe, expect, it } from 'vitest';
import { restTransitions } from './transitions.ts';
import type { Skin } from './skins.ts';

const skin: Pick<Skin, 'animations'> = { animations: {
  idle: [[0, 0]],
  wave: [[1, 75], [2, 75], [3, 65], [4, 65], [3, 65], [2, 75], [1, 75], [0, 0]],
  sleep: [[5, 100], [6, 100], [7, 0]],
  drag: [[8, 65], [9, 65], [10, 0]],
} };

describe('returning to rest when an action is interrupted', () => {
  it('puts a lifted leg down through the drag entry poses in reverse', () => {
    expect(restTransitions(skin).get(10)?.map(([frame]) => frame)).toEqual([9, 8, 0]);
  });
  it('wakes through the eyelid and head entry poses, without a zero-duration stop', () => {
    const route = restTransitions(skin).get(7)!;
    expect(route.map(([frame]) => frame)).toEqual([6, 5, 0]);
    expect(route.every(([, ms]) => ms >= 120 && ms <= 220)).toBe(true);
  });
  it('exits a wave through adjoining poses instead of replaying the waving cycle', () => {
    expect(restTransitions(skin).get(4)?.map(([frame]) => frame)).toEqual([3, 2, 1, 0]);
  });
  it('adds no recovery delay when already standing', () => {
    expect(restTransitions(skin).get(0)).toEqual([]);
    expect(restTransitions({ animations: {} }).get(0)).toEqual([]);
  });
});
