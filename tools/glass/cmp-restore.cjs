// Compares the backup taken before the recovery run with progress.json after it.
// Keys the pet does not write must be equal; exposure and seenDays may only gain entries.
const fs = require('node:fs');
const [before, after] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
let ok = true;
const check = (name, cond, detail = '') => { ok &&= cond; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };
check('same top-level keys kept', Object.keys(before).every((k) => k in after), Object.keys(after).join(','));
check('srs cards equal', JSON.stringify(before.srs) === JSON.stringify(after.srs), `${Object.keys(before.srs ?? {}).length} cards`);
check('reviewDays equal', JSON.stringify(before.reviewDays) === JSON.stringify(after.reviewDays));
const lost = Object.keys(before.exposure ?? {}).filter((id) => !(id in after.exposure));
const older = Object.keys(before.exposure ?? {}).filter((id) => after.exposure[id] && (after.exposure[id].n < before.exposure[id].n || after.exposure[id].t < before.exposure[id].t));
check('exposure kept (only additions or newer showings)', !lost.length && !older.length, `before ${Object.keys(before.exposure).length}, after ${Object.keys(after.exposure).length}, lost ${lost.length}, older ${older.length}`);
const days = (x) => (Array.isArray(x) ? x : Object.keys(x ?? {}));
check('seenDays kept', days(before.seenDays).every((d) => days(after.seenDays).includes(d)));
process.exit(ok ? 0 : 1);
