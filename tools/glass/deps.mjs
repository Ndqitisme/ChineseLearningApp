// Result cache for the measurement tools: one file per measured unit (a page or a bubble window in one theme, mode,
// glass mode and window size), named by a hash of everything that can change what that unit renders. A unit whose
// inputs did not change since it was last measured is read back instead of measured again.
// NOCACHE=1 measures everything and overwrites the cache.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { REPO, WORK } from './harness.mjs';

const walk = (dir) => readdirSync(`${REPO}/${dir}`, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

/** Page file for a route hash; null when the route is not known (then every page file counts). */
const PAGE_FILE = {
  '': 'Home', topics: 'Topics', topic: 'Topic', hsk: 'Topic', word: 'Word', practice: 'Practice', quiz: 'Quiz', review: 'Review',
  write: 'Write', build: 'Build', tones: 'Tones', search: 'Search', notebook: 'Notebook', settings: 'Settings', about: 'About', support: 'Support',
};
const PAGES_DIR = 'src/main/pages/';

/** Page files a page file imports, itself included. */
function pageClosure(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const m of readFileSync(`${REPO}/${file}`, 'utf8').matchAll(/from '\.\/(\w+\.svelte)'/g)) {
    if (existsSync(`${REPO}/${PAGES_DIR}${m[1]}`)) pageClosure(PAGES_DIR + m[1], seen);
  }
  return seen;
}

// Stroke files are left out: data:build writes them together with dataset.json, which is hashed.
const SHARED = [
  'index.html', 'pet.html', 'vite.config.ts', 'pnpm-lock.yaml', 'src/generated/dataset.json', 'tools/e2e/tauri-mock.js', 'tools/chrome-profile.ts',
  'tools/glass/harness.mjs', 'tools/glass/deps.mjs',
  ...['fonts', 'icons', 'logo', 'skins', 'support'].flatMap((d) => walk(`public/${d}`)),
];
const SRC = walk('src').filter((f) => !f.endsWith('.test.ts') && !f.startsWith('src/generated/'));
const digests = new Map();
const digest = (f) => { if (!digests.has(f)) digests.set(f, createHash('sha256').update(readFileSync(`${REPO}/${f}`)).digest('hex')); return digests.get(f); };

/** Hash of the files behind a main-window route ('#/tones') or the bubble window ('pet'). */
function inputs(unit, tool) {
  let files;
  if (unit === 'pet') files = SRC.filter((f) => !f.startsWith('src/main/'));
  else {
    const name = PAGE_FILE[unit.replace(/^#\//, '').split('/')[0]];
    const own = name ? pageClosure(`${PAGES_DIR}${name}.svelte`) : null;
    files = SRC.filter((f) => !f.startsWith('src/pet/') && (!own || !f.startsWith(PAGES_DIR) || own.has(f)));
  }
  const h = createHash('sha256');
  for (const f of [`tools/glass/${tool}`, ...SHARED, ...files].sort()) h.update(f).update(digest(f));
  return h.digest('hex');
}

/** cache(tool, chrome).get(unit, key) returns the stored rows or null; .put(unit, key, rows) stores them.
 *  `unit` picks the source files, `key` is everything else that tells two measurements apart. */
export function cache(tool, chrome) {
  const dir = `${WORK}/cache/${tool.replace(/\.mjs$/, '')}`;
  mkdirSync(dir, { recursive: true });
  const file = (unit, key) => `${dir}/${createHash('sha256').update(JSON.stringify([chrome, inputs(unit, tool), unit, key])).digest('hex').slice(0, 32)}.json`;
  return {
    get(unit, key) { const f = file(unit, key); return !process.env.NOCACHE && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; },
    put(unit, key, rows) { writeFileSync(file(unit, key), JSON.stringify(rows)); },
  };
}
