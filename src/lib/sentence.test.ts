import { describe, expect, it } from 'vitest';
import { score, tiles } from './sentence.ts';

describe('tiles', () => {
  it('splits hand-marked answers on spaces and drops punctuation', () => {
    expect(tiles('我 很 好，谢谢。')).toEqual(['我', '很', '好', '谢谢']);
  });

  it('cuts unmarked sentences by longest dictionary word', () => {
    const t = tiles('这家饭馆的菜很好吃。');
    expect(t.join('')).toBe('这家饭馆的菜很好吃');
    expect(t).toContain('饭馆');
    expect(t).toContain('好吃');
  });
});

describe('score', () => {
  const target = ['我', '想', '喝', '一', '杯', '咖啡'];

  it('gives 100 for the exact order', () => {
    expect(score([...target], [target])).toEqual({ points: 100, inPlace: target.map(() => true), target: 0 });
  });

  it('gives partial credit for one swapped pair', () => {
    const s = score(['我', '喝', '想', '一', '杯', '咖啡'], [target]);
    expect(s.points).toBe(83);
    expect(s.inPlace.filter(Boolean)).toHaveLength(5);
  });

  it('counts an unfinished answer against the whole sentence', () => {
    expect(score(['我', '想'], [target]).points).toBe(33);
  });

  it('handles repeated tiles', () => {
    const t = ['我', '的', '书', '的', '颜色'];
    expect(score(['我', '的', '书', '的', '颜色'], [t]).points).toBe(100);
    expect(score(['的', '我', '的', '书', '颜色'], [t]).points).toBe(80);
  });

  it('accepts any of the listed orderings', () => {
    const a = ['我', '早上', '九', '点', '上班'];
    const b = ['早上', '九', '点', '我', '上班'];
    const s = score(b, [a, b]);
    expect(s).toMatchObject({ points: 100, target: 1 });
  });
});
