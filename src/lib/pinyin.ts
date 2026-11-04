// Pinyin helpers shared by the app and the data build. Numeric form uses "ü" and tone 5 for neutral.

export type Tone = 1 | 2 | 3 | 4 | 5;
export interface Syllable { py: string; tone: Tone }

const MARKS: Record<string, string> = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
const UNMARK = new Map<string, { base: string; tone: Tone }>();
for (const [base, marks] of Object.entries(MARKS)) {
  [...marks].forEach((m, i) => {
    UNMARK.set(m, { base, tone: (i + 1) as Tone });
    UNMARK.set(m.toUpperCase(), { base: base.toUpperCase(), tone: (i + 1) as Tone });
  });
}
const VOWELS = 'aeiouü';

/** "ni3" → "nǐ", "lu:4"/"lv4"/"lü4" → "lǜ", "ma5"/"ma" → "ma". Case is preserved. */
export function numericToMarked(numeric: string): string {
  const m = numeric.match(/^(.*?)([1-5])?$/)!;
  const body = m[1].replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü');
  const tone = m[2] ? Number(m[2]) : 5;
  if (tone === 5) return body;
  const lower = body.toLowerCase();
  let idx = lower.indexOf('a');
  if (idx < 0) idx = lower.indexOf('e');
  if (idx < 0) idx = lower.indexOf('ou');
  if (idx < 0) {
    for (let i = lower.length - 1; i >= 0; i--) if (VOWELS.includes(lower[i])) { idx = i; break; }
  }
  if (idx < 0) return body; // syllabic m/n/ng/r: no vowel to mark
  const ch = lower[idx];
  let marked = MARKS[ch][tone - 1];
  if (body[idx] !== ch) marked = marked.toUpperCase();
  return body.slice(0, idx) + marked + body.slice(idx + 1);
}

/** "nǚ" → { py: "nü", tone: 3 }; unmarked → tone 5. */
export function parseMarked(marked: string): { base: string; tone: Tone } {
  let tone: Tone = 5;
  let base = '';
  for (const c of marked) {
    const u = UNMARK.get(c);
    if (u) { tone = u.tone; base += u.base; } else base += c;
  }
  return { base, tone };
}

export function toneOf(marked: string): Tone {
  return parseMarked(marked).tone;
}

/** Lowercase, no tone marks, ü→v, no spaces/apostrophes: the key used for pinyin search ("mǐfàn" → "mifan"). */
export function searchKey(s: string): string {
  return parseMarked(s.toLowerCase()).base.replace(/ü/g, 'v').replace(/[\s'’·-]/g, '');
}

/** Joins syllables into one written word, adding the apostrophe before a/o/e syllables. */
export function joinWord(syllables: string[]): string {
  return syllables
    .map((s, i) => (i > 0 && /^[aoeāáǎàōóǒòēéěè]/i.test(s) ? `'${s}` : s))
    .join('');
}

/**
 * Splits written pinyin ("mǐfàn", "Xī'ān", "shǎo bīng") into exactly `count` syllables.
 * Spaces, apostrophes and hyphens are hard boundaries; inside a chunk we search all
 * segmentations into valid syllables. Returns null when no segmentation fits.
 */
export function splitSyllables(written: string, count: number, valid: Set<string>): string[] | null {
  const chunks = written.split(/[\s'’-]+/).filter(Boolean);
  const out: string[] = [];
  const walk = (ci: number, pos: number): boolean => {
    if (ci === chunks.length) return out.length === count;
    const chunk = chunks[ci];
    if (pos === chunk.length) return walk(ci + 1, 0);
    if (out.length >= count) return false;
    for (let len = Math.min(6, chunk.length - pos); len >= 1; len--) {
      const piece = chunk.slice(pos, pos + len);
      // Orthography: a syllable starting with a/o/e inside a word must be preceded by an
      // apostrophe, so without one it can't start here ("Hénèi" is Hé|nèi, not Hén|èi).
      if (pos > 0 && /^[aoeāáǎàōóǒòēéěè]/i.test(piece)) continue;
      if (!valid.has(parseMarked(piece.toLowerCase()).base)) continue;
      out.push(piece);
      if (walk(ci, pos + len)) return true;
      out.pop();
    }
    return false;
  };
  return walk(0, 0) ? [...out] : null;
}

export function toSyllables(markedSyllables: string[]): Syllable[] {
  return markedSyllables.map((py) => ({ py, tone: toneOf(py) }));
}

const HAN = /\p{Script=Han}/u;
export function isHan(ch: string): boolean {
  return HAN.test(ch);
}
