// Cards for review. The nav badge, Home, Practice and the Review page count this same list.
import { progress, today, type SrsCardJson } from '../lib/progress.svelte.ts';
import { TARGET_EXPOSURES, type Exposure } from '../lib/scheduler.ts';
import { openWordAnyEdition } from '../lib/settings.svelte.ts';

/** Words shown enough times that review may turn into new cards per day. */
export const NEW_PER_DAY = 10;
/** A card graded in a session comes back in that session when it is due again within this many minutes. */
export const LEARN_AHEAD_MIN = 20;

/** Due cards, oldest first, then up to `newLeft` words shown enough times that have no card yet. */
export function queueIds(
  srs: Record<string, SrsCardJson>, exposure: Record<string, Exposure>, open: (id: string) => boolean, now: number, newLeft: number,
): string[] {
  const due = Object.entries(srs)
    .filter(([id, c]) => Date.parse(c.due) <= now && open(id))
    .sort((a, b) => Date.parse(a[1].due) - Date.parse(b[1].due))
    .map(([id]) => id);
  const fresh = Object.entries(exposure)
    .filter(([id, e]) => !srs[id] && !e.k && e.n >= TARGET_EXPOSURES && open(id))
    .slice(0, Math.max(0, newLeft))
    .map(([id]) => id);
  return [...due, ...fresh];
}

/** Words review turned into new cards on `day`. */
export interface NewCards { day: string; ids: string[] }

/** How many new cards review may still start on `day`. */
export function newLeft(started: NewCards, day: string): number {
  return NEW_PER_DAY - (started.day === day ? started.ids.length : 0);
}

const KEY = 'reviewNewCards';
function load(): NewCards {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.day === 'string' && Array.isArray(v.ids)) return v;
  } catch { /* storage unavailable or damaged: start the day fresh */ }
  return { day: '', ids: [] };
}
const started = $state(load());

/** Moved on a timer while the window is visible: due times pass without any other change. */
export const clock = $state({ now: Date.now() });

export function startClock(): () => void {
  const tick = () => { if (document.visibilityState === 'visible') clock.now = Date.now(); };
  const timer = setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', tick);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
}

export function reviewQueueIds(): string[] {
  const day = today(new Date(clock.now));
  return queueIds(progress.srs, progress.exposure, (id) => !!openWordAnyEdition(id), clock.now, newLeft(started, day));
}

/** Review calls this when it grades a word that had no card yet. */
export function countNewCard(id: string) {
  const day = today();
  if (started.day !== day) Object.assign(started, { day, ids: [] });
  if (!started.ids.includes(id)) started.ids.push(id);
  clock.now = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify($state.snapshot(started))); } catch { /* storage unavailable */ }
}
