// Downloads upstream sources into .cache/sources and verifies them against sources.lock.json.
// Usage: node tools/data/fetch-sources.ts [--update]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, SOURCES } from './sources.ts';

const LOCK = 'tools/data/sources.lock.json';
const update = process.argv.includes('--update');
const lock: Record<string, string> = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : {};
const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

mkdirSync(CACHE_DIR, { recursive: true });
let failed = false;
for (const src of SOURCES) {
  const path = join(CACHE_DIR, src.file);
  if (existsSync(path) && lock[src.id] === sha256(readFileSync(path))) {
    console.log(`ok      ${src.id}`);
    continue;
  }
  const res = await fetch(src.url);
  if (!res.ok) {
    console.error(`FAILED  ${src.id}: HTTP ${res.status} ${src.url}`);
    failed = true;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = sha256(buf);
  if (lock[src.id] !== hash && !update) {
    console.error(lock[src.id]
      ? `CHANGED ${src.id}: upstream content differs from sources.lock.json. Review it, then rerun with --update.`
      : `NEW     ${src.id}: not pinned in sources.lock.json. Review it, then rerun with --update to pin it.`);
    failed = true;
    continue;
  }
  writeFileSync(path, buf);
  lock[src.id] = hash;
  console.log(`fetched ${src.id} (${(buf.length / 1024).toFixed(0)} KB)`);
}
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
if (failed) process.exit(1);
