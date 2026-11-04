import raw from '../generated/dataset.json';
import type { Dataset, Topic, Word } from './types.ts';

export const dataset = raw as unknown as Dataset;
export const words: Word[] = dataset.words;
export const topics: Topic[] = dataset.topics;
export const wordById = new Map(words.map((w) => [w.id, w]));
export const topicById = new Map(topics.map((t) => [t.id, t]));

export const GROUPS = [
  { id: 'daily', title: 'Đời sống', icon: '🏡' },
  { id: 'food', title: 'Ăn uống', icon: '🍜' },
  { id: 'work', title: 'Công việc', icon: '💼' },
] as const;

/** Words the assistant may show: enabled topics (in teaching order) then enabled HSK levels. */
export function studyPool(topicIds: string[], hskLevels: number[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  // Interleave topics so the first minutes aren't all greetings.
  const lists = topics.filter((t) => topicIds.includes(t.id)).map((t) => t.words);
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) add(l[i]);
  for (const level of [1, 2, 3] as const) if (hskLevels.includes(level)) dataset.hsk[level].forEach(add);
  return out;
}

/** For segmenting arbitrary text: hanzi string → word (first entry wins). */
export const wordByHanzi = new Map<string, Word>();
for (const w of words) if (!wordByHanzi.has(w.hanzi)) wordByHanzi.set(w.hanzi, w);
export const MAX_WORD_LEN = Math.max(...words.map((w) => [...w.hanzi].length));
