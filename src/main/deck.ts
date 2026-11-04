// Which words a practice session draws from, and how wrong answers are chosen.
import { dataset, studyPool, topicById, wordById, words } from '../lib/data.ts';
import { progress } from '../lib/progress.svelte.ts';
import { settings } from '../lib/settings.svelte.ts';
import type { Word } from '../lib/types.ts';

export interface Deck { title: string; words: Word[] }

const byIds = (ids: string[]) => ids.map((id) => wordById.get(id)).filter((w): w is Word => !!w);

/**
 * Route params → deck. ["topic", id] | ["hsk", "2"] | ["starred"] | [] (words Tiểu Mai has
 * already shown, falling back to the assistant's study pool for a brand-new user).
 */
export function deckFrom(params: string[]): Deck {
  const [kind, arg] = params;
  if (kind === 'topic' && topicById.has(arg)) {
    const t = topicById.get(arg)!;
    return { title: `${t.icon} ${t.title}`, words: byIds(t.words) };
  }
  if (kind === 'hsk' && ['1', '2', '3'].includes(arg)) {
    return { title: `HSK ${arg}`, words: byIds(dataset.hsk[arg as '1' | '2' | '3']) };
  }
  if (kind === 'starred') {
    return { title: '★ Sổ tay', words: byIds(Object.keys(progress.exposure).filter((id) => progress.exposure[id].s)) };
  }
  const seen = Object.entries(progress.exposure)
    .filter(([, e]) => e.n > 0)
    .sort((a, b) => b[1].t - a[1].t)
    .map(([id]) => id);
  if (seen.length >= 8) return { title: 'Từ Tiểu Mai đã cho bạn xem', words: byIds(seen) };
  return { title: 'Từ đang học', words: byIds(studyPool(settings.topics, settings.hsk).slice(0, 40)) };
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Plausible wrong options: same topic or HSK level first, never the same meaning or characters. */
export function distractors(word: Word, count: number, key: (w: Word) => string): Word[] {
  const sameGroup = words.filter(
    (w) => w.id !== word.id && (w.topics.some((t) => word.topics.includes(t)) || (w.hsk && w.hsk === word.hsk)),
  );
  const out: Word[] = [];
  const used = new Set([key(word), word.hanzi]);
  for (const pool of [shuffle(sameGroup), shuffle(words)]) {
    for (const w of pool) {
      if (out.length >= count) return out;
      if (used.has(key(w)) || used.has(w.hanzi)) continue;
      used.add(key(w));
      used.add(w.hanzi);
      out.push(w);
    }
  }
  return out;
}
