import type { Syllable } from './pinyin.ts';
import type { IconName } from './ui/icon-names.ts';

export type TopicGroup = 'daily' | 'food' | 'work';

export type HskLevel = 1 | 2 | 3 | 4 | 5 | 6;
/** HSK 3.0 word lists: the 2021 standard, or the syllabus finalized in November 2025. */
export type HskEdition = 2021 | 2025;

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
  /** Level in the 2021 lists. */
  hsk?: HskLevel;
  /** Level in the 2025 lists. A word can sit at different levels in the two editions, or in only one. */
  hsk2025?: HskLevel;
  topics: string[];
  /** Frequency rank (lower = more common). */
  freq?: number;
  ex?: Example;
}

export interface Topic {
  id: string;
  group: TopicGroup;
  icon: IconName;
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
  /** Word ids per HSK level (2021 lists), ordered by frequency. Levels 4–6 appear once `loadLevels` has loaded them. */
  hsk: LevelIds;
  /** The same for the 2025 lists. */
  hsk2025: LevelIds;
  qa: QA[];
}

export type LevelIds = Record<'1' | '2' | '3', string[]> & Partial<Record<'4' | '5' | '6', string[]>>;

/** One unlockable HSK level (src/generated/hsk4–6.json), loaded on demand. */
export interface LevelPack {
  level: 4 | 5 | 6;
  /** Words whose lowest level in either edition is this one, minus core words (topic words stay in the core). */
  words: Word[];
  /** All word ids at this level in the 2021 lists, frequency order. */
  ids: string[];
  /** The same for the 2025 lists. */
  ids2025: string[];
}
