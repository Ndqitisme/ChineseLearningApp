// Active-learning schedule (FSRS). Cards are stored as JSON with ISO dates in progress.srs.
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';
import type { SrsCardJson } from './progress.svelte.ts';

const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 });

export { Rating };
export type { Grade };

function toCard(json: SrsCardJson | undefined, now: Date): Card {
  if (!json) return createEmptyCard(now);
  return { ...json, due: new Date(json.due), last_review: json.last_review ? new Date(json.last_review) : undefined } as Card;
}

function toJson(card: Card): SrsCardJson {
  return {
    due: card.due.toISOString(), stability: card.stability, difficulty: card.difficulty,
    elapsed_days: card.elapsed_days, scheduled_days: card.scheduled_days, learning_steps: card.learning_steps,
    reps: card.reps, lapses: card.lapses, state: card.state, last_review: card.last_review?.toISOString(),
  };
}

export function review(json: SrsCardJson | undefined, grade: Grade, now = new Date()): SrsCardJson {
  return toJson(scheduler.next(toCard(json, now), now, grade).card);
}

/** Next interval per grade, shown on the flashcard buttons. */
export function previewIntervals(json: SrsCardJson | undefined, now = new Date()): Record<Grade, string> {
  const card = toCard(json, now);
  const out = {} as Record<Grade, string>;
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    const due = scheduler.next(card, now, g).card.due.getTime();
    out[g] = humanize(due - now.getTime());
  }
  return out;
}

function humanize(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} phút`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} giờ`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} ngày`;
  const m = Math.round(d / 30);
  return m < 12 ? `${m} tháng` : `${(d / 365).toFixed(1)} năm`;
}

/** Maps a multiple-choice answer to an FSRS grade: wrong → Again, slow → Hard, quick → Good. */
export function gradeFromAnswer(correct: boolean, ms: number): Grade {
  if (!correct) return Rating.Again;
  return ms > 8000 ? Rating.Hard : Rating.Good;
}

export function isDue(json: SrsCardJson | undefined, now = Date.now()): boolean {
  return !!json && Date.parse(json.due) <= now;
}
