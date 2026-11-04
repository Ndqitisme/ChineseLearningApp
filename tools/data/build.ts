// Builds src/generated/*.json and public/strokes/* from upstream sources + data/ overlays.
// Fails (exit 1) on anything a learner would see as broken: missing pinyin, meaning or Hán Việt.
// Usage: node tools/data/build.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin as pinyinPro } from 'pinyin-pro';
import {
  isHan, joinWord, numericToMarked, parseMarked, splitSyllables, toSyllables,
} from '../../src/lib/pinyin.ts';
import type { Dataset, Example, Topic, TopicGroup, Word } from '../../src/lib/types.ts';
import { fullGloss, parseCedict, referenceOf, shortGloss, type CedictEntry } from './cedict.ts';
import { CACHE_DIR } from './sources.ts';

const REPORT_DIR = '.cache/reports';
const OUT_DIR = 'src/generated';
const STROKES_DIR = 'public/strokes';

const errors: string[] = [];
const reports: Record<string, string[]> = {};
const report = (name: string, line: string) => (reports[name] ??= []).push(line);

const readTsv = (path: string) =>
  existsSync(path)
    ? readFileSync(path, 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t'))
    : [];

/** Numeric pinyin syllable normalized for lookups: lowercase, ü, tone digit 1–5. */
const normNum = (s: string) => {
  const t = s.toLowerCase().replace(/u:|v/g, 'ü');
  return /[1-5]$/.test(t) ? t : `${t}5`;
};

// ---------------------------------------------------------------- sources
const cedict = parseCedict(readFileSync(join(CACHE_DIR, 'CVDICT.u8'), 'utf8'));
const validSyllables = new Set<string>();
for (const entries of cedict.values())
  for (const e of entries) for (const s of e.numeric) validSyllables.add(normNum(s).slice(0, -1));

interface HskForm { traditional: string; transcriptions: { pinyin: string; numeric: string } }
interface HskWord { simplified: string; level: string[]; frequency: number; forms: HskForm[] }
const hskAll: HskWord[] = JSON.parse(readFileSync(join(CACHE_DIR, 'complete-hsk.json'), 'utf8'));

const hanvietChars = new Map<string, string>();
for (const [ch, py, hv] of readTsv('data/hanviet/chars.tsv')) hanvietChars.set(`${ch}|${normNum(py)}`, hv.trim());
const hanvietWords = new Map(readTsv('data/hanviet/word-overrides.tsv').map(([w, hv]) => [w, hv.trim()]));
// Per-word review: `show` only when the reading is a real Vietnamese (Hán Việt) word with a related
// meaning; transliterations (咖啡 "ca phi") and character-by-character readings (没关系 "một quan hệ")
// are hidden. Every word needs a verdict, so new words cannot ship unreviewed.
const hanvietVerdicts = new Map(
  readTsv('data/hanviet/word-verdicts.tsv').map(([w, verdict, hv]) => [w, { show: verdict === 'show', reading: hv?.trim() ?? '' }]),
);
const hskPinyinOverrides = new Map(readTsv('data/hsk-pinyin-overrides.tsv').map(([w, py]) => [w, py.trim()]));
const glossOverrides = new Map(readTsv('data/gloss-overrides.tsv').map(([w, vi]) => [w, vi.trim()]));

// ---------------------------------------------------------------- helpers
function cedictEntry(hanzi: string, numeric: string[], hops = 1): CedictEntry | undefined {
  const key = numeric.map(normNum).join(' ');
  const candidates = (cedict.get(hanzi) ?? []).filter((e) => e.numeric.map(normNum).join(' ') === key);
  // Prefer lowercase (non proper-noun) entries that are not mere "variant of" stubs.
  const entry =
    candidates.find((e) => !/^[A-Z]/.test(e.numeric[0]) && !e.variantOnly) ??
    candidates.find((e) => !e.variantOnly) ??
    candidates[0];
  const ref = entry && hops > 0 ? referenceOf(entry) : null;
  return ref ? (cedictEntry(ref.simp, ref.numeric, hops - 1) ?? entry) : entry;
}

function hanvietFor(hanzi: string, numeric: string[], context: string): string {
  const override = hanvietWords.get(hanzi);
  if (override) return override;
  const chars = [...hanzi].filter(isHan);
  if (chars.length !== numeric.length) {
    errors.push(`${context}: ${hanzi} has ${chars.length} Han chars but ${numeric.length} syllables`);
    return '';
  }
  return chars
    .map((c, i) => {
      const n = normNum(numeric[i]);
      const exact = hanvietChars.get(`${c}|${n}`);
      if (exact) return exact;
      // Neutral-tone and toneless variants share the reading of the same syllable.
      const base = n.slice(0, -1);
      for (const t of '12345') {
        const hv = hanvietChars.get(`${c}|${base}${t}`);
        if (hv) return hv;
      }
      report('hanviet-missing', `${c}\t${n}\t${hanzi}`);
      return '?';
    })
    .join(' ');
}

/** The HSK JSON sometimes has marked pinyin in its numeric field ("jiànguò"); re-derive those. */
function hskNumeric(hanzi: string, form: HskForm): string[] | null {
  const hanCount = [...hanzi].filter(isHan).length;
  const tokens = form.transcriptions.numeric.split(' ');
  if (tokens.length === hanCount && tokens.every((t) => /^[a-zü:]+[1-5]$/i.test(t))) return tokens;
  const stripDigits = (t: string) => t.replace(/([^\d\s])[1-5](?=\s|$)/g, '$1');
  const sylls = splitSyllables(stripDigits(form.transcriptions.pinyin), hanCount, validSyllables)
    ?? splitSyllables(form.transcriptions.numeric.replace(/[1-5]/g, '$& '), hanCount, validSyllables);
  return sylls?.map((s) => { const p = parseMarked(s.replace(/[1-5]$/, '')); return p.base.toLowerCase() + (/[1-5]$/.test(s) ? s.slice(-1) : p.tone); }) ?? null;
}

/** 面条儿 → the entry for 面条: CVDICT rarely lists erhua spellings separately. */
function erhuaFallback(hanzi: string, numeric: string[]): CedictEntry | undefined {
  if (!hanzi.endsWith('儿') || numeric.length < 2) return undefined;
  return cedictEntry(hanzi.slice(0, -1), numeric.slice(0, -1));
}

const proNumeric = (text: string) =>
  pinyinPro(text, { type: 'array', toneType: 'num', nonZh: 'removed' }).map((s) => s.replace(/0$/, '5'));

// ---------------------------------------------------------------- HSK 1–3
const words = new Map<string, Word>();
const hskLevels: Dataset['hsk'] = { '1': [], '2': [], '3': [] };

for (const hw of hskAll) {
  const levels = hw.level.map((l) => /^new-([123])$/.exec(l)?.[1]).filter(Boolean).map(Number);
  if (!levels.length) continue;
  const level = Math.min(...levels) as 1 | 2 | 3;
  const forms = hw.forms.filter((f) => !/^[A-Z]/.test(f.transcriptions.numeric));
  const pool = forms.length ? forms : hw.forms;

  let form = pool[0];
  const override = hskPinyinOverrides.get(hw.simplified);
  const uniqueNumerics = new Set(pool.map((f) => f.transcriptions.numeric.split(' ').map(normNum).join(' ')));
  if (override) {
    const want = override.split(' ').map(normNum).join(' ');
    const hit = pool.find((f) => f.transcriptions.numeric.split(' ').map(normNum).join(' ') === want);
    if (!hit) errors.push(`hsk-pinyin-overrides: ${hw.simplified} has no form "${override}"`);
    else form = hit;
  } else if (uniqueNumerics.size > 1) {
    const guess = proNumeric(hw.simplified).map(normNum).join(' ');
    form = pool.find((f) => f.transcriptions.numeric.split(' ').map(normNum).join(' ') === guess) ?? pool[0];
    report('hsk-polyphones', `${hw.simplified}\t${form.transcriptions.numeric}\t(options: ${[...uniqueNumerics].join(' | ')})`);
  }

  const numeric = hskNumeric(hw.simplified, form);
  if (!numeric) { errors.push(`HSK ${hw.simplified}: unusable pinyin "${form.transcriptions.pinyin}"`); continue; }
  const marked = numeric.map(numericToMarked);
  const entry = cedictEntry(hw.simplified, numeric) ?? erhuaFallback(hw.simplified, numeric);
  const vi = glossOverrides.get(hw.simplified) ?? (entry ? shortGloss(entry.senses) : '');
  if (!vi) errors.push(`HSK ${hw.simplified} [${numeric.join(' ')}]: no Vietnamese meaning (add to data/gloss-overrides.tsv)`);

  const word: Word = {
    id: hw.simplified,
    hanzi: hw.simplified,
    pinyin: joinWord(marked),
    syllables: toSyllables(marked),
    vi,
    viFull: entry ? fullGloss(entry.senses) : undefined,
    hanviet: hanvietFor(hw.simplified, numeric, `HSK ${level}`),
    hsk: level,
    topics: [],
    freq: hw.frequency,
  };
  words.set(word.id, word);
  hskLevels[level].push(word.id);
}
for (const ids of Object.values(hskLevels)) ids.sort((a, b) => (words.get(a)!.freq ?? 1e9) - (words.get(b)!.freq ?? 1e9));

// ---------------------------------------------------------------- topics
interface AuthoredWord { hanzi: string; pinyin: string; vi: string; ex?: Example }
const topicIndex: Omit<Topic, 'words'>[] = JSON.parse(readFileSync('data/topics/_index.json', 'utf8'));
const topics: Topic[] = [];

for (const meta of topicIndex) {
  const file: { id: string; words: AuthoredWord[] } = JSON.parse(readFileSync(`data/topics/${meta.id}.json`, 'utf8'));
  if (file.id !== meta.id) errors.push(`data/topics/${meta.id}.json: id is "${file.id}"`);
  const topic: Topic = { ...meta, group: meta.group as TopicGroup, words: [] };

  for (const aw of file.words) {
    const ctx = `topic ${meta.id}: ${aw.hanzi}`;
    const hanCount = [...aw.hanzi].filter(isHan).length;
    const sylls = splitSyllables(aw.pinyin, hanCount, validSyllables);
    if (!sylls) { errors.push(`${ctx}: cannot split pinyin "${aw.pinyin}" into ${hanCount} syllables`); continue; }
    const numeric = sylls.map((s) => { const p = parseMarked(s); return p.base.toLowerCase() + p.tone; });
    if (aw.ex) checkExample(aw.ex, ctx);

    const existing = words.get(aw.hanzi);
    if (existing) {
      const hskNum = existing.syllables.map((s) => normNum(parseMarked(s.py).base + s.tone));
      if (hskNum.join(' ') !== numeric.join(' ')) {
        // The editor marked a neutral tone the dictionary lists in citation form (多少 duōshao):
        // that matches everyday speech, so the hand-written reading wins. Other diffs are only reported.
        const onlyNeutral = hskNum.every((h, i) => h === numeric[i] || (h.slice(0, -1) === numeric[i].slice(0, -1) && numeric[i].endsWith('5')));
        if (onlyNeutral) {
          existing.pinyin = aw.pinyin;
          existing.syllables = toSyllables(sylls);
        } else {
          report('topic-vs-hsk-pinyin', `${aw.hanzi}\tHSK ${existing.pinyin}\ttopic ${aw.pinyin}\t(${meta.id})`);
        }
      }
      if (!existing.topics.includes(meta.id)) existing.topics.push(meta.id);
      existing.vi = glossOverrides.get(aw.hanzi) ?? aw.vi; // hand-written gloss beats the dictionary cut
      existing.ex ??= aw.ex;
      topic.words.push(existing.id);
      continue;
    }
    const entry = cedictEntry(aw.hanzi, numeric);
    if (!entry) report('topic-not-in-cvdict', `${aw.hanzi}\t${aw.pinyin}\t(${meta.id})`);
    const word: Word = {
      id: aw.hanzi,
      hanzi: aw.hanzi,
      pinyin: aw.pinyin,
      syllables: toSyllables(sylls),
      vi: glossOverrides.get(aw.hanzi) ?? aw.vi,
      viFull: entry ? fullGloss(entry.senses) : undefined,
      hanviet: hanvietFor(aw.hanzi, numeric, `topic ${meta.id}`),
      topics: [meta.id],
      ex: aw.ex,
    };
    words.set(word.id, word);
    topic.words.push(word.id);
  }
  topics.push(topic);
}

/** Cross-checks hand-written example pinyin against pinyin-pro, char by char. */
function checkExample(ex: Example, ctx: string) {
  const han = [...ex.zh].filter(isHan);
  const latin = ex.zh.match(/[A-Za-z0-9]+/g) ?? [];
  let py = ex.py.replace(/[.,!?;:，。！？、“”"()（）…—~]/g, ' ');
  for (const token of latin) py = py.replace(new RegExp(`\\b${token}\\b`, 'i'), ' ');
  const sylls = splitSyllables(py, han.length, validSyllables);
  if (!sylls) { errors.push(`${ctx}: example pinyin does not align with "${ex.zh}"`); return; }
  const pro = pinyinPro(ex.zh, { type: 'array', nonZh: 'removed' });
  han.forEach((ch, i) => {
    const a = parseMarked(sylls[i].toLowerCase());
    const b = parseMarked(pro[i] ?? '');
    if (a.base === b.base && a.tone === b.tone) return;
    if (a.base === 'r' && ch === '儿') return; // erhua
    if (a.base === b.base && (a.tone === 5 || b.tone === 5 || ch === '一' || ch === '不')) return; // neutral / 一不 sandhi
    report('example-pinyin-diff', `${ch}\twritten ${sylls[i]}\tpinyin-pro ${pro[i]}\t${ex.zh}\t${ctx}`);
  });
}

// ---------------------------------------------------------------- strokes
const strokeChars = new Set<string>();
for (const w of words.values()) for (const c of w.hanzi) if (isHan(c)) strokeChars.add(c);
rmSync(STROKES_DIR, { recursive: true, force: true });
mkdirSync(STROKES_DIR, { recursive: true });
const hwd = 'node_modules/hanzi-writer-data';
for (const c of strokeChars) {
  const src = join(hwd, `${c}.json`);
  if (existsSync(src)) copyFileSync(src, join(STROKES_DIR, `${c}.json`));
  else report('strokes-missing', c);
}
mkdirSync('public/licenses', { recursive: true });
copyFileSync(join(hwd, 'ARPHICPL.TXT'), 'public/licenses/ARPHICPL.TXT');

// ---------------------------------------------------------------- validate + write
for (const w of words.values()) {
  if (!w.pinyin || !w.syllables.length) errors.push(`${w.id}: missing pinyin`);
  if (!w.vi) errors.push(`${w.id}: missing Vietnamese meaning`);
  const verdict = hanvietVerdicts.get(w.hanzi);
  if (!verdict) errors.push(`${w.id}: no Hán Việt verdict in data/hanviet/word-verdicts.tsv`);
  else if (!verdict.show) delete w.hanviet;
  else {
    if (verdict.reading && verdict.reading !== w.hanviet) {
      report('hanviet-corrected', `${w.id}	${w.hanviet}	${verdict.reading}`);
      w.hanviet = verdict.reading;
    }
    if (!w.hanviet || w.hanviet.includes('?')) errors.push(`${w.id}: missing Hán Việt (${w.hanviet})`);
  }
}

const charset = new Set<string>();
for (const w of words.values()) {
  for (const c of w.hanzi + (w.ex?.zh ?? '')) charset.add(c);
}
for (const t of topics) for (const c of t.titleZh) charset.add(c);

mkdirSync(REPORT_DIR, { recursive: true });
for (const [name, lines] of Object.entries(reports)) writeFileSync(join(REPORT_DIR, `${name}.tsv`), lines.join('\n') + '\n');
writeFileSync('.cache/charset.txt', [...charset].filter(isHan).join(''));

const dataset: Dataset = { words: [...words.values()], topics, hsk: hskLevels };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'dataset.json'), JSON.stringify(dataset));

const count = (pred: (w: Word) => boolean) => dataset.words.filter(pred).length;
console.log(`words ${dataset.words.length}  (HSK1 ${hskLevels[1].length}, HSK2 ${hskLevels[2].length}, HSK3 ${hskLevels[3].length}, topic-only ${count((w) => !w.hsk)})`);
console.log(`topics ${topics.length}  topic words ${topics.reduce((n, t) => n + t.words.length, 0)}  with example ${count((w) => !!w.ex)}`);
console.log(`stroke files ${strokeChars.size - (reports['strokes-missing']?.length ?? 0)}/${strokeChars.size}  charset ${[...charset].filter(isHan).length}`);
for (const [name, lines] of Object.entries(reports)) console.log(`report ${name}: ${lines.length} → ${REPORT_DIR}/${name}.tsv`);
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors.slice(0, 40)) console.error('  ' + e);
  process.exit(1);
}
