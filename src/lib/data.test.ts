import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import core from '../generated/dataset.json';
import hsk4 from '../generated/hsk4.json';
import hsk5 from '../generated/hsk5.json';
import hsk6 from '../generated/hsk6.json';
import { dataset, loadLevels, MAX_WORD_LEN, wordByHanzi, wordById, words } from './data.ts';
import type { Dataset, LevelPack, Word } from './types.ts';

const coreSet = core as unknown as Dataset;
const packs = [hsk4, hsk5, hsk6] as unknown as LevelPack[];
const coreById = new Map(coreSet.words.map((w) => [w.id, w]));
const allById = new Map([...coreById, ...packs.flatMap((p) => p.words.map((w) => [w.id, w] as const))]);
/** A word ships in the pack of its lowest level across the two editions. */
const minLevel = (w: Word) => Math.min(w.hsk ?? 9, w.hsk2025 ?? 9);
const verdicts = new Set(
  readFileSync('data/hanviet/word-verdicts.tsv', 'utf8').split(/\r?\n/).slice(1).map((l) => l.split('\t')[0]),
);

describe('HSK 4–6 packs', () => {
  it('never repeat an id from the core or another pack', () => {
    const seen = new Set(coreById.keys());
    for (const p of packs) for (const w of p.words) {
      expect(seen.has(w.id), `${w.id} (HSK ${p.level})`).toBe(false);
      seen.add(w.id);
    }
  });

  it('give every word pinyin, a Vietnamese meaning and a Hán Việt verdict', () => {
    for (const p of packs) for (const w of p.words) {
      expect(w.pinyin && w.syllables.length, w.id).toBeTruthy();
      expect(w.vi, w.id).toBeTruthy();
      expect(verdicts.has(w.hanzi), w.id).toBe(true);
      expect(minLevel(w), w.id).toBe(p.level);
    }
  });

  it('list every level id of both editions in frequency order, each resolving to a word of that level', () => {
    for (const p of packs) {
      for (const [ids, levelOf] of [[p.ids, (w?: Word) => w?.hsk], [p.ids2025, (w?: Word) => w?.hsk2025]] as const) {
        const freqs = ids.map((id) => {
          const w = allById.get(id);
          expect(levelOf(w), `${id} (HSK ${p.level})`).toBe(p.level);
          return w?.freq ?? 1e9;
        });
        expect(freqs).toEqual([...freqs].sort((a, b) => a - b));
      }
      // Loading packs up to n gives every word either edition lists at level n or below.
      for (const id of [...p.ids, ...p.ids2025]) {
        const w = allById.get(id)!;
        expect(coreById.has(id) || minLevel(w) <= p.level, id).toBe(true);
      }
    }
  });

  it('keep HSK 1–3 of both editions in the core', () => {
    for (const levels of [coreSet.hsk, coreSet.hsk2025])
      for (const level of ['1', '2', '3'] as const) for (const id of levels[level]) expect(coreById.has(id), id).toBe(true);
  });

  it('keep topic words in the core', () => {
    for (const p of packs) for (const w of p.words) expect(w.topics, w.id).toEqual([]);
    const topicIds = new Set(coreSet.topics.flatMap((t) => t.words));
    for (const id of topicIds) expect(coreById.has(id), id).toBe(true);
  });
});

describe('loadLevels', () => {
  it('merges packs once, however often it is called', async () => {
    const coreCount = words.length;
    await Promise.all([loadLevels(5), loadLevels(6)]);
    await loadLevels(6);
    await loadLevels(4);
    const total = coreCount + packs.reduce((n, p) => n + p.words.length, 0);
    expect(words.length).toBe(total);
    expect(new Set(words.map((w) => w.id)).size).toBe(total);
    expect(wordById.size).toBe(total);
    for (const p of packs) {
      expect(dataset.hsk[p.level]).toEqual(p.ids);
      expect(dataset.hsk2025[p.level]).toEqual(p.ids2025);
      for (const id of p.ids) expect(wordById.has(id), id).toBe(true);
      for (const w of p.words) expect(wordByHanzi.has(w.hanzi), w.hanzi).toBe(true);
    }
    expect(MAX_WORD_LEN).toBe(Math.max(...words.map((w) => [...w.hanzi].length)));
    expect(words.slice(coreCount).map(minLevel)).toEqual(packs.flatMap((p) => p.words.map(() => p.level)));
  });
});
