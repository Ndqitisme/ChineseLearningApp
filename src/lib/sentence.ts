import { MAX_WORD_LEN } from './data.ts';
import { openByHanzi } from './settings.svelte.ts';
import { isHan } from './pinyin.ts';

const SEPARATORS = /[\s，。？！、；：,.?!;:“”"'（）()…—~]+/;

/**
 * Word tiles of a sentence, punctuation dropped. Text with spaces ("我 叫 小梅。") is split on
 * them as written; otherwise Han runs are cut by longest dictionary match.
 */
export function tiles(text: string): string[] {
  if (/\S\s+\S/.test(text)) return text.split(SEPARATORS).filter(Boolean);
  const out: string[] = [];
  for (const run of text.split(SEPARATORS).filter(Boolean)) {
    const chars = [...run];
    let i = 0;
    while (i < chars.length) {
      if (!isHan(chars[i])) {
        let j = i;
        while (j < chars.length && !isHan(chars[j])) j++;
        out.push(chars.slice(i, j).join(''));
        i = j;
        continue;
      }
      let len = Math.min(MAX_WORD_LEN, chars.length - i);
      while (len > 1 && !openByHanzi(chars.slice(i, i + len).join(''))) len--;
      out.push(chars.slice(i, i + len).join(''));
      i += len;
    }
  }
  return out;
}

/** The sentence as displayed: spaces that only mark tiles are removed. */
export const plain = (text: string) => text.replace(/ /g, '');

export interface Score {
  /** 0–100: share of the target's tiles that the answer has in the right relative order. */
  points: number;
  /** Per answer tile: part of that longest in-order run. */
  inPlace: boolean[];
  /** Index of the accepted sentence the answer was scored against. */
  target: number;
}

/** Longest common subsequence of tiles; marks which answer tiles belong to it. */
function lcs(answer: string[], target: string[]): { length: number; inPlace: boolean[] } {
  const n = answer.length, m = target.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = answer[i] === target[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const inPlace = new Array<boolean>(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (answer[i] === target[j]) { inPlace[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { length: dp[0][0], inPlace };
}

/** Scores an answer against every accepted ordering and keeps the best. */
export function score(answer: string[], accepted: string[][]): Score {
  let best: Score = { points: 0, inPlace: answer.map(() => false), target: 0 };
  accepted.forEach((target, t) => {
    const { length, inPlace } = lcs(answer, target);
    const points = Math.round((100 * length) / Math.max(target.length, answer.length));
    if (points > best.points) best = { points, inPlace, target: t };
  });
  return best;
}
