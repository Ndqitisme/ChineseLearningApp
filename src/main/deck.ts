// Which words a practice session draws from, and how wrong answers are chosen.
import { studyPool, topicById, words } from '../lib/data.ts';
import { progress } from '../lib/progress.svelte.ts';
import { hskIds, hskLevel, isOpen, openWord, openWordAnyEdition, settings } from '../lib/settings.svelte.ts';
import type { HskLevel, Word } from '../lib/types.ts';

export interface Deck {
  title: string;
  words: Word[];
  /** Set when the asked-for deck cannot be served (a locked level, a lesson past the end): why, and where to go. */
  gone?: { text: string; link: string; href: string };
}

/** Words per lesson on an HSK course page. */
export const LESSON_SIZE = 25;

const byIds = (ids: string[]) => ids.map((id) => openWord(id)).filter((w): w is Word => !!w);

/**
 * Route params → deck. ["topic", id] | ["hsk", "2"] | ["hsk", "5", lesson] | ["starred"] | [] (words Tiểu Mai has
 * already shown, falling back to the assistant's study pool for a brand-new user).
 */
export function deckFrom(params: string[]): Deck {
  const [kind, arg, lesson] = params;
  if (kind === 'topic' && topicById.has(arg)) {
    const t = topicById.get(arg)!;
    return { title: t.title, words: byIds(t.words) };
  }
  if (kind === 'hsk' && /^[1-6]$/.test(arg)) {
    const course = { link: `Xem khoá HSK ${arg}`, href: `#/hsk/${arg}` };
    if (+arg > settings.hskOpen) return { title: `HSK ${arg}`, words: [], gone: { text: `HSK ${arg} đang khoá.`, ...course } };
    const ids = hskIds(+arg as HskLevel) ?? [];
    const n = Number(lesson);
    if (lesson === undefined) return { title: `HSK ${arg}`, words: byIds(ids) };
    const title = `HSK ${arg} · Bài ${lesson}`;
    if (!Number.isInteger(n) || n < 1 || (n - 1) * LESSON_SIZE >= ids.length) {
      return { title, words: [], gone: { text: `HSK ${arg} không có Bài ${lesson}.`, ...course } };
    }
    return { title, words: byIds(ids.slice((n - 1) * LESSON_SIZE, n * LESSON_SIZE)) };
  }
  if (kind === 'starred') {
    // The notebook keeps its words across an edition switch, like the Notebook page.
    const ids = Object.keys(progress.exposure).filter((id) => progress.exposure[id].s);
    return { title: '★ Sổ tay', words: ids.map((id) => openWordAnyEdition(id)).filter((w): w is Word => !!w) };
  }
  // Counted after byIds: words of re-locked or not-loaded levels do not make the deck playable.
  const seen = byIds(Object.entries(progress.exposure)
    .filter(([, e]) => e.n > 0)
    .sort((a, b) => b[1].t - a[1].t)
    .map(([id]) => id));
  if (seen.length >= 8) return { title: 'Từ đã gặp', words: seen };
  return { title: 'Từ đang học', words: byIds(studyPool(settings.topics, settings.hsk, settings.hskEdition).slice(0, 40)) };
}

/** The page a practice on these deck params belongs to: where Back goes when this window has no history. */
export function deckOrigin(params: string[]): string {
  const [kind, arg] = params;
  if (kind === 'topic') return `/topic/${arg}`;
  if (kind === 'hsk') return `/hsk/${arg}`;
  if (kind === 'starred') return '/notebook';
  return '/practice';
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
  const open = words.filter(isOpen);
  const level = hskLevel(word);
  const sameGroup = open.filter(
    (w) => w.id !== word.id && (w.topics.some((t) => word.topics.includes(t)) || (level !== undefined && hskLevel(w) === level)),
  );
  const out: Word[] = [];
  // Meaning and characters are both excluded whatever the quiz shows: a wrong option with the prompt's meaning would be a second right answer.
  const used = new Set([key(word), word.hanzi, word.vi]);
  for (const pool of [shuffle(sameGroup), shuffle(open)]) {
    for (const w of pool) {
      if (out.length >= count) return out;
      if (used.has(key(w)) || used.has(w.hanzi) || used.has(w.vi)) continue;
      used.add(key(w));
      used.add(w.hanzi);
      used.add(w.vi);
      out.push(w);
    }
  }
  return out;
}
