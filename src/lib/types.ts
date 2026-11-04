import type { Syllable } from './pinyin.ts';

export type TopicGroup = 'daily' | 'food' | 'work';

export interface Example { zh: string; py: string; vi: string }

export interface Word {
  /** Simplified hanzi; `hanzi|pinyin` only when two entries share the same characters. */
  id: string;
  hanzi: string;
  /** Written pinyin with tone marks, e.g. "mǐfàn". */
  pinyin: string;
  syllables: Syllable[];
  /** Short Vietnamese meaning shown in the bubble (≤ ~32 chars). */
  vi: string;
  /** Longer Vietnamese definition from CVDICT, when available. */
  viFull?: string;
  /** Sino-Vietnamese reading, one syllable per Han character; only for real Hán Việt words. */
  hanviet?: string;
  hsk?: 1 | 2 | 3;
  topics: string[];
  /** Frequency rank (lower = more common). */
  freq?: number;
  ex?: Example;
}

export interface Topic {
  id: string;
  group: TopicGroup;
  icon: string;
  title: string;
  titleZh: string;
  /** Word ids in teaching order. */
  words: string[];
}

/** A question whose answer is rebuilt from word tiles. In `a` / `alt`, spaces mark the tiles ("我 叫 小梅。"). */
export interface QA { id: string; topic: string; q: string; qVi: string; a: string; alt?: string[]; aPy: string; aVi: string }

export interface Dataset {
  words: Word[];
  topics: Topic[];
  /** Word ids per HSK level, ordered by frequency. */
  hsk: Record<'1' | '2' | '3', string[]>;
  qa: QA[];
}
