// Learning progress in "progress.json". Each key has exactly one writer to avoid lost updates
// between windows: the pet window owns `exposure` and `seenDays`; the main window owns `srs`
// and `reviewDays`. Other windows ask the owner to change a key via events (see ipc.ts).
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Exposure } from './scheduler.ts';

export type DayCounts = Record<string, number>; // "YYYY-MM-DD" → count

export interface SrsCardJson {
  due: string; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number;
  learning_steps: number; reps: number; lapses: number; state: number; last_review?: string;
}

export const progress = $state({
  exposure: {} as Record<string, Exposure>,
  srs: {} as Record<string, SrsCardJson>,
  seenDays: {} as DayCounts,
  reviewDays: {} as DayCounts,
  pausedUntil: 0,
});
type Key = keyof typeof progress;
const KEYS: Key[] = ['exposure', 'srs', 'seenDays', 'reviewDays', 'pausedUntil'];

let store: Store | undefined;

/** A damaged or hand-edited file can hold anything; a value of the wrong type reads as empty. */
function valid(key: Key, v: unknown): unknown {
  if (key === 'pausedUntil') return typeof v === 'number' ? v : 0;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export async function initProgress() {
  store = await load('progress.json', { autoSave: 1500, defaults: {} });
  for (const key of KEYS) {
    const v = await store.get(key);
    if (v !== undefined) (progress as Record<Key, unknown>)[key] = valid(key, v);
    await store.onKeyChange(key, (nv) => { if (nv !== undefined) (progress as Record<Key, unknown>)[key] = valid(key, nv); });
  }
}

export async function saveProgress(key: Key) {
  await store?.set(key, $state.snapshot(progress[key]));
}

export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Consecutive days (ending today or yesterday) with any activity. */
export function streak(): number {
  const active = (d: Date) => (progress.seenDays[today(d)] ?? 0) + (progress.reviewDays[today(d)] ?? 0) > 0;
  const d = new Date();
  if (!active(d)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (active(d)) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
