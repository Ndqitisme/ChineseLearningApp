// Writes review shards: every word with its levels in both editions, reading, Hán Việt verdict, meaning and Wiktionary evidence.
// Wiktionary marks Sino-Vietnamese words with their Han spelling ({{vi-etym-sino|詞典}}), so a shown reading with no entry,
// or a hidden one with an exact entry, is worth a second look. Review aid only; nothing from the dump ships.
// Dump (CC BY-SA): https://kaikki.org/dictionary/Vietnamese/words/kaikki.org-dictionary-Vietnamese-words.jsonl
// Usage: node tools/data/build.ts; node tools/data/review-shards.ts <dump.jsonl> <out-dir> [rows-per-shard]
import { createReadStream, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Dataset, LevelPack, Word } from '../../src/lib/types.ts';

const [dump, outDir, sizeArg] = process.argv.slice(2);
if (!dump || !outDir) { console.error('usage: node tools/data/review-shards.ts <dump.jsonl> <out-dir> [rows-per-shard]'); process.exit(1); }
const SIZE = Number(sizeArg) || 300;

const lines = (path: string) => readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
const isHanOnly = (s: string) => /^\p{Script=Han}+$/u.test(s);

/** Vietnamese spelling key: tone moved to the end of each syllable ("hoà" = "hòa") and final y read as i ("tỷ" = "tỉ"). */
function viKey(text: string): string {
  return text.toLowerCase().normalize('NFD').split(/\s+/).filter(Boolean).map((syl) => {
    const tone = /[̣̀́̃̉]/.exec(syl)?.[0] ?? '';
    const bare = syl.replace(/[̣̀́̃̉]/g, '').normalize('NFC');
    return bare.replace(/^([bcdđghklmnpqrstvx]+)y$/, '$1i') + tone;
  }).join(' ');
}

// ---------------------------------------------------------------- Wiktionary: Han spelling → Vietnamese words
interface WiktEntry { word: string; gloss: string }
const wikt = new Map<string, WiktEntry[]>();
const rl = createInterface({ input: createReadStream(dump, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.includes('vi-etym-sino')) continue;
  const e = JSON.parse(line) as { word: string; etymology_templates?: { name: string; args?: Record<string, string> }[]; senses?: { glosses?: string[] }[] };
  const gloss = (e.senses ?? []).map((s) => s.glosses?.at(-1)).filter(Boolean).slice(0, 2).join('; ');
  for (const t of e.etymology_templates ?? []) {
    if (t.name !== 'vi-etym-sino' || !t.args) continue;
    // Positional args alternate Han, gloss, Han, gloss…; a whole word may also sit in arg 1 alone.
    const han = Object.entries(t.args).filter(([k, v]) => /^\d+$/.test(k) && Number(k) % 2 === 1 && isHanOnly(v)).map(([, v]) => v).join('');
    if (!han) continue;
    const list = wikt.get(han) ?? [];
    if (!list.some((x) => x.word === e.word)) list.push({ word: e.word, gloss: gloss.slice(0, 90) });
    wikt.set(han, list);
  }
}

// ---------------------------------------------------------------- app data
const dataset = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8')) as Dataset;
const all = new Map<string, Word>(dataset.words.map((w) => [w.id, w]));
for (const level of [4, 5, 6]) for (const w of (JSON.parse(readFileSync(`src/generated/hsk${level}.json`, 'utf8')) as LevelPack).words) all.set(w.id, w);

const verdicts = new Map(lines('data/hanviet/word-verdicts.tsv').slice(1).map((l) => {
  const [w, verdict, reading, reason] = l.split('\t');
  return [w, { verdict, reading: reading?.trim() ?? '', reason: reason?.trim() ?? '' }];
}));

interface Row { cells: string[]; flags: string[] }
const rows: Row[] = [];
const counts: Record<string, number> = {};
for (const line of lines('.cache/reports/hanviet-candidates.tsv')) {
  const [id, , pinyin, computed, vi, viFull, trad] = line.split('\t');
  const w = all.get(id);
  if (!w) continue;
  const v = verdicts.get(id);
  const reading = v?.reading || computed;
  const han = [...w.hanzi].filter((c) => /\p{Script=Han}/u.test(c)).join('');
  const entries = [...(wikt.get(trad) ?? []), ...(trad !== han ? wikt.get(han) ?? [] : [])];
  const exact = entries.filter((x) => viKey(x.word) === viKey(reading));
  const evidence = (exact.length ? 'match: ' : entries.length ? 'other: ' : '') + (exact.length ? exact : entries).slice(0, 3).map((x) => `${x.word} = ${x.gloss}`).join(' | ');

  const flags: string[] = [];
  if (/\p{Script=Han}/u.test(vi)) flags.push('han-in-vi');
  if (vi.endsWith('…')) flags.push('cut');
  if ((vi.match(/\(/g)?.length ?? 0) !== (vi.match(/\)/g)?.length ?? 0)) flags.push('paren');
  if (vi.length > 34) flags.push('long');
  const single = han.length === 1;
  if (!v) flags.push('needs-verdict');
  else if (v.verdict === 'show' && !single && !exact.length) flags.push('show-no-wikt');
  else if (v.verdict === 'hide' && exact.length) flags.push('hidden-but-wikt');
  if (single && v?.verdict === 'show' && wikt.has(han) && !wikt.get(han)!.some((x) => viKey(x.word) === viKey(reading))) flags.push('char-reading?');
  for (const f of flags) counts[f] = (counts[f] ?? 0) + 1;

  rows.push({
    flags,
    cells: [id, String(w.hsk ?? ''), String(w.hsk2025 ?? ''), w.topics.length ? 'topic' : '', pinyin, v?.verdict ?? 'NEW', reading, v?.reason ?? '',
      vi, (viFull ?? '').slice(0, 200), evidence, flags.join(' ')],
  });
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^shard-\d+\.tsv$/.test(f)) rmSync(join(outDir, f));
const header = 'id\thsk2021\thsk2025\ttopic\tpinyin\tverdict\thanviet\treason\tvi\tviFull\twiktionary\tflags';
const shards = Math.ceil(rows.length / SIZE);
for (let i = 0; i < shards; i++) {
  const part = rows.slice(i * SIZE, (i + 1) * SIZE).map((r) => r.cells.map((c) => c.replace(/[\t\n]/g, ' ')).join('\t'));
  writeFileSync(join(outDir, `shard-${String(i + 1).padStart(2, '0')}.tsv`), [header, ...part].join('\n') + '\n');
}
console.log(`wiktionary Han spellings ${wikt.size}; rows ${rows.length} in ${shards} shard(s) of ≤${SIZE} → ${outDir}`);
console.log(Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
