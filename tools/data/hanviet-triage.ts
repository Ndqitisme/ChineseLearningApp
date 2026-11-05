// Triages HSK 4–6 words without a reviewed Hán Việt verdict. Safe to rerun.
// Single characters with a reading and a content meaning are shown; other words are hidden as "chưa duyệt" until
// reviewed. Words whose reading
// appears in their own CVDICT definition go to auto-show.tsv, the rest to in-NN.tsv shards.
// Usage: node tools/data/build.ts; node tools/data/hanviet-triage.ts <out-dir>
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERDICTS = 'data/hanviet/word-verdicts.tsv';
const PENDING = 'chưa duyệt';
const SHARDS = 8;
const HEADER = '# HSK 4–6: first pass by tools/data/hanviet-triage.ts';
const outDir = process.argv[2];
if (!outDir) { console.error('usage: node tools/data/hanviet-triage.ts <out-dir>'); process.exit(1); }

const lines = (path: string) => readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
const isHan = (c: string) => /\p{Script=Han}/u.test(c);
// Particles and sound words have a reading but no Vietnamese word behind it.
const FUNCTION_WORD = /^\(?(thán từ|trợ từ|từ tượng thanh|tiểu từ|từ cảm thán|âm thanh)|^[^;]*!/i;

const verdicts = new Map(lines(VERDICTS).slice(1).map((l) => { const [w, , , reason] = l.split('\t'); return [w, reason ?? '']; }));

interface Row { word: string; pinyin: string; reading: string; vi: string; viFull: string }
const rows: Row[] = [];
for (const line of lines('.cache/reports/hanviet-candidates.tsv')) {
  const [word, hsk, pinyin, reading, vi, viFull] = line.split('\t');
  if (Number(hsk) < 4) continue;
  const reason = verdicts.get(word);
  if (reason !== undefined && reason !== PENDING) continue; // already reviewed
  rows.push({ word, pinyin, reading, vi, viFull });
}

const containsWord = (text: string, phrase: string) =>
  new RegExp(`(^|[^\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(text.normalize('NFC'));

const newVerdicts: string[] = [];
const auto: Row[] = [];
const unknown: Row[] = [];
for (const r of rows) {
  const readable = r.reading && !r.reading.includes('?');
  const single = [...r.word].filter(isHan).length === 1;
  if (single && readable && !FUNCTION_WORD.test(r.vi)) {
    if (!verdicts.has(r.word)) newVerdicts.push(`${r.word}\tshow\t\t1 chữ`);
    continue;
  }
  if (!verdicts.has(r.word)) newVerdicts.push(`${r.word}\thide\t\t${PENDING}`);
  if (!single && readable && containsWord(`${r.vi}; ${r.viFull}`, r.reading.normalize('NFC'))) auto.push(r);
  else unknown.push(r);
}

if (newVerdicts.length) {
  const text = readFileSync(VERDICTS, 'utf8');
  appendFileSync(VERDICTS, (text.endsWith('\n') ? '' : '\n') + (text.includes(HEADER) ? '' : HEADER + '\n') + newVerdicts.join('\n') + '\n');
}

const tsv = (list: Row[]) => ['word\tpinyin\thanviet\tvi', ...list.map((r) => [r.word, r.pinyin, r.reading, r.vi].join('\t'))].join('\n') + '\n';
mkdirSync(outDir, { recursive: true });
for (const f of existsSync(outDir) ? readdirSync(outDir) : []) if (/^in-\d+\.tsv$/.test(f)) rmSync(join(outDir, f));
writeFileSync(join(outDir, 'auto-show.tsv'), tsv(auto));
const size = Math.ceil(unknown.length / SHARDS);
for (let i = 0; i * size < unknown.length; i++)
  writeFileSync(join(outDir, `in-${String(i + 1).padStart(2, '0')}.tsv`), tsv(unknown.slice(i * size, (i + 1) * size)));

const shown = rows.length - auto.length - unknown.length;
console.log(`pending ${rows.length}: 1 chữ show ${shown}, auto-show candidates ${auto.length}, unknown ${unknown.length} in ${Math.ceil(unknown.length / size || 0)} shard(s)`);
console.log(`new verdict rows ${newVerdicts.length} → ${VERDICTS}`);
