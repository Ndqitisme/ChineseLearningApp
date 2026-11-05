// Cards for one review session. The nav badge, Home and Practice count this same list.
import { progress } from '../lib/progress.svelte.ts';
import { TARGET_EXPOSURES } from '../lib/scheduler.ts';
import { openWord } from '../lib/settings.svelte.ts';
import { isDue } from '../lib/srs.ts';

/** New words a session adds on top of the due cards. */
const NEW_PER_SESSION = 10;

/** Due cards, oldest first, then up to NEW_PER_SESSION words shown enough times that have no card yet. */
export function reviewQueueIds(): string[] {
  const due = Object.entries(progress.srs)
    .filter(([id, c]) => isDue(c) && openWord(id))
    .sort((a, b) => Date.parse(a[1].due) - Date.parse(b[1].due))
    .map(([id]) => id);
  const fresh = Object.entries(progress.exposure)
    .filter(([id, e]) => !progress.srs[id] && !e.k && e.n >= TARGET_EXPOSURES && openWord(id))
    .slice(0, NEW_PER_SESSION)
    .map(([id]) => id);
  return [...due, ...fresh];
}
