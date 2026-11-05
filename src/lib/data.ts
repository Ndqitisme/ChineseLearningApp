import raw from '../generated/dataset.json';
import type { Dataset, HskEdition, HskLevel, LevelIds, LevelPack, Topic, Word } from './types.ts';

export const dataset = raw as unknown as Dataset;
export const words: Word[] = dataset.words;
export const topics: Topic[] = dataset.topics;
export const wordById = new Map(words.map((w) => [w.id, w]));
export const topicById = new Map(topics.map((t) => [t.id, t]));

export const GROUPS = [
  { id: 'daily', title: 'Đời sống', icon: 'group-daily' },
  { id: 'food', title: 'Ăn uống', icon: 'group-food' },
  { id: 'work', title: 'Công việc', icon: 'group-work' },
] as const;

/** A word's level in `edition`; undefined when that edition does not list it. */
export const levelOf = (w: Word, edition: HskEdition): HskLevel | undefined => (edition === 2025 ? w.hsk2025 : w.hsk);
/** Word ids per level in `edition`. */
export const levelIds = (edition: HskEdition): LevelIds => (edition === 2025 ? dataset.hsk2025 : dataset.hsk);

/** Words the assistant may show: enabled topics (in teaching order) then enabled HSK levels of `edition`. */
export function studyPool(topicIds: string[], hskLevels: number[], edition: HskEdition): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  // Interleave topics so the first minutes aren't all greetings.
  const lists = topics.filter((t) => topicIds.includes(t.id)).map((t) => t.words);
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) add(l[i]);
  for (const level of [1, 2, 3, 4, 5, 6] as const) if (hskLevels.includes(level)) levelIds(edition)[level]?.forEach(add);
  return out;
}

/** For segmenting arbitrary text: hanzi string → word (first entry wins). */
export const wordByHanzi = new Map<string, Word>();
for (const w of words) if (!wordByHanzi.has(w.hanzi)) wordByHanzi.set(w.hanzi, w);
export let MAX_WORD_LEN = Math.max(...words.map((w) => [...w.hanzi].length));

// Vite turns each into its own chunk, fetched only when that level is unlocked.
const PACKS: Record<4 | 5 | 6, () => Promise<{ default: unknown }>> = {
  4: () => import('../generated/hsk4.json'),
  5: () => import('../generated/hsk5.json'),
  6: () => import('../generated/hsk6.json'),
};
const loading = new Map<number, Promise<void>>();

/** Loads HSK 4…`max` into `words`, the lookup maps and `dataset`. Safe to call repeatedly. */
export function loadLevels(max: number): Promise<void> {
  const levels = ([4, 5, 6] as const).filter((l) => l <= max);
  for (const level of levels) {
    if (loading.has(level)) continue;
    // Packs download in parallel but merge in level order, so `words` order does not depend on timing.
    const load = Promise.all([PACKS[level](), loading.get(level - 1)]).then(([{ default: raw }]) => {
      const pack = raw as LevelPack;
      for (const w of pack.words) {
        words.push(w);
        wordById.set(w.id, w);
        if (!wordByHanzi.has(w.hanzi)) wordByHanzi.set(w.hanzi, w);
        MAX_WORD_LEN = Math.max(MAX_WORD_LEN, [...w.hanzi].length);
      }
      dataset.hsk[level] = pack.ids;
      dataset.hsk2025[level] = pack.ids2025;
    });
    // A failed load (missing chunk) must not stay cached as done: the next call retries it.
    loading.set(level, load.catch((e) => { loading.delete(level); throw e; }));
  }
  return Promise.all(levels.map((l) => loading.get(l))).then(() => {});
}
