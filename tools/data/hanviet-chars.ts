// Fills data/hanviet/chars.tsv with the (char, pinyin) pairs the build reported missing, from the pinned
// hanviet-pinyin-wordlist (MIT, keyed by traditional char + pinyin). Safe to rerun: only adds missing pairs.
// Usage: node tools/data/build.ts; node tools/data/hanviet-chars.ts; node tools/data/build.ts
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from './sources.ts';

const CHARS = 'data/hanviet/chars.tsv';
const HEADER = '# HSK 4–6 characters: hanviet-pinyin-wordlist (MIT, ph0ngp), added by tools/data/hanviet-chars.ts';

const normNum = (s: string) => {
  const t = s.toLowerCase().replace(/u:|v/g, 'ü');
  return /[1-5]$/.test(t) ? t : `${t}5`;
};
const lines = (path: string) => readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));

// char → pinyin ('*' = any reading) → first listed Hán Việt reading
const source = new Map<string, Map<string, string>>();
for (const line of lines(join(CACHE_DIR, 'hanviet-pinyin.csv')).slice(1)) {
  const m = /^(.),"?\[(.*)\]"?,(.+)$/u.exec(line);
  if (!m) { console.error(`unparsed source line: ${line}`); process.exit(1); }
  const reading = /'([^']+)'/.exec(m[2])?.[1];
  if (!reading) continue;
  const byPinyin = source.get(m[1]) ?? new Map<string, string>();
  const py = m[3] === '*' ? '*' : normNum(m[3]);
  if (!byPinyin.has(py)) byPinyin.set(py, reading);
  source.set(m[1], byPinyin);
}

interface HskWord { simplified: string; forms: { traditional: string }[] }
const traditional = new Map<string, string[]>();
for (const hw of JSON.parse(readFileSync(join(CACHE_DIR, 'complete-hsk.json'), 'utf8')) as HskWord[])
  traditional.set(hw.simplified, hw.forms.map((f) => f.traditional));

/** Traditional forms of `char` as written in `word` (a simplified char can map to several). */
function tradOf(char: string, word: string): string[] {
  const simp = [...word];
  const out = new Set<string>();
  for (const trad of traditional.get(word) ?? []) {
    const t = [...trad];
    if (t.length === simp.length) simp.forEach((c, i) => { if (c === char) out.add(t[i]); });
  }
  out.add(char);
  return [...out];
}

function lookup(char: string, py: string, word: string): { reading: string; note: string } | null {
  const forms = tradOf(char, word);
  for (const f of forms) { const r = source.get(f)?.get(py); if (r) return { reading: r, note: `${f} ${py}` }; }
  for (const f of forms) { const r = source.get(f)?.get('*'); if (r) return { reading: r, note: `${f} *` }; }
  // Neutral tone, or a tone the list does not record: the same syllable in another tone.
  const base = py.slice(0, -1);
  for (const f of forms)
    for (const [p, r] of source.get(f) ?? []) if (p.slice(0, -1) === base) return { reading: r, note: `${f} ${p} (tone fallback)` };
  return null;
}

const have = new Set(lines(CHARS).slice(1).map((l) => { const [c, py] = l.split('\t'); return `${c}|${normNum(py)}`; }));
const added: string[] = [];
const unresolved: string[] = [];
const fallbacks: string[] = [];
const MISSING = '.cache/reports/hanviet-missing.tsv';
for (const line of existsSync(MISSING) ? lines(MISSING) : []) {
  const [char, py, word] = line.split('\t');
  const key = `${char}|${normNum(py)}`;
  if (have.has(key)) continue;
  have.add(key);
  const hit = lookup(char, normNum(py), word);
  if (!hit) { unresolved.push(`${char}\t${py}\t${word}`); continue; }
  if (hit.note.includes('fallback')) fallbacks.push(`${char}\t${py}\t${hit.reading}\t${hit.note}`);
  added.push(`${char}\t${normNum(py)}\t${hit.reading}`);
}

if (added.length) {
  const text = readFileSync(CHARS, 'utf8');
  appendFileSync(CHARS, (text.endsWith('\n') ? '' : '\n') + (text.includes(HEADER) ? '' : HEADER + '\n') + added.join('\n') + '\n');
}
console.log(`added ${added.length} (tone fallback ${fallbacks.length}), unresolved ${unresolved.length}`);
for (const f of fallbacks) console.log(`  fallback  ${f}`);
for (const u of unresolved) console.log(`  missing   ${u}`);
