// Picks the next word for the assistant's bubble (passive exposure).
// A small batch of new words is shown repeatedly at growing gaps until each has been
// seen TARGET times; then it becomes "familiar" and is only refreshed now and then.

export interface Exposure {
  /** Times shown. */
  n: number;
  /** Last shown, epoch minutes. */
  t: number;
  /** User said "I know this". */
  k?: 1;
  /** Starred into the notebook. */
  s?: 1;
}

export interface PickInput {
  pool: string[];
  exposure: Record<string, Exposure>;
  /** FSRS cards due for review (active learning). */
  due: string[];
  /** Most recently shown ids, newest last. */
  recent: string[];
  now: number;
  rand?: () => number;
  batchSize?: number;
}

export type PickReason = 'new' | 'learning' | 'familiar' | 'due' | 'known';
export interface Pick { id: string; reason: PickReason }

export const TARGET_EXPOSURES = 5;
/** Minutes to wait before showing a learning word again, by times already shown. */
const GAP_MIN = [0, 1, 3, 8, 20];
const RECENT_WINDOW = 5;

export function pickNext(input: PickInput): Pick | null {
  const { pool, exposure, now } = input;
  const rand = input.rand ?? Math.random;
  const batch = input.batchSize ?? 6;
  const recent = new Set(input.recent.slice(-RECENT_WINDOW));
  const ok = (id: string) => !recent.has(id);

  const learning: string[] = [];
  const familiar: string[] = [];
  const known: string[] = [];
  const fresh: string[] = [];
  for (const id of pool) {
    const e = exposure[id];
    if (e?.k) known.push(id);
    else if (!e || e.n === 0) fresh.push(id);
    else if (e.n < TARGET_EXPOSURES) learning.push(id);
    else familiar.push(id);
  }

  const overdue = (id: string) => {
    const e = exposure[id];
    return now - e.t - GAP_MIN[Math.min(e.n, GAP_MIN.length - 1)];
  };
  const pickLearning = (): Pick | null => {
    const candidates = learning.filter(ok).sort((a, b) => overdue(b) - overdue(a));
    if (candidates.length && overdue(candidates[0]) >= 0) return { id: candidates[0], reason: 'learning' };
    const next = fresh.find(ok);
    if (next && learning.length < batch) return { id: next, reason: 'new' };
    // Gaps are soft: with nothing due, the closest-to-due word beats an immediate repeat.
    if (candidates.length) return { id: candidates[0], reason: 'learning' };
    return next ? { id: next, reason: 'new' } : null;
  };
  const oldestOf = (ids: string[], reason: PickReason): Pick | null => {
    const candidates = ids.filter(ok).sort((a, b) => (exposure[a]?.t ?? 0) - (exposure[b]?.t ?? 0));
    if (!candidates.length) return null;
    // A little randomness among the oldest few keeps the rotation from feeling mechanical.
    return { id: candidates[Math.floor(rand() * Math.min(5, candidates.length))], reason };
  };

  const r = rand();
  const order: (() => Pick | null)[] =
    r < 0.15 ? [() => oldestOf(input.due, 'due'), pickLearning, () => oldestOf(familiar, 'familiar')]
    : r < 0.4 ? [() => oldestOf(familiar, 'familiar'), pickLearning, () => oldestOf(input.due, 'due')]
    : r < 0.43 ? [() => oldestOf(known, 'known'), pickLearning, () => oldestOf(familiar, 'familiar')]
    : [pickLearning, () => oldestOf(familiar, 'familiar'), () => oldestOf(input.due, 'due')];
  for (const f of order) {
    const p = f();
    if (p) return p;
  }
  // Everything eligible was shown very recently (tiny pools): allow a repeat rather than stall.
  const any = [...learning, ...fresh, ...familiar, ...known].find((id) => id !== input.recent.at(-1));
  return any ? { id: any, reason: exposure[any] ? 'familiar' : 'new' } : null;
}

export function recordExposure(exposure: Record<string, Exposure>, id: string, now: number) {
  const e = exposure[id] ?? { n: 0, t: now };
  exposure[id] = { ...e, n: e.n + 1, t: now };
}
