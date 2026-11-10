// CC-CEDICT-format parsing (CVDICT uses the same line format) and Vietnamese gloss trimming.

export interface CedictEntry { trad: string; numeric: string[]; senses: string[]; variantOnly: boolean }

const LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
const VARIANT = /^(biến thể|cách viết cũ|dạng cổ) (của|) ?/i;

export function parseCedict(text: string): Map<string, CedictEntry[]> {
  const map = new Map<string, CedictEntry[]>();
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const senses = m[4].split('/').map((s) => s.trim()).filter(Boolean);
    const entry: CedictEntry = {
      trad: m[1],
      numeric: m[3].split(' '),
      senses,
      variantOnly: senses.every((s) => VARIANT.test(s)),
    };
    const list = map.get(m[2]);
    if (list) list.push(entry);
    else map.set(m[2], [entry]);
  }
  return map;
}

/** Drops cross-reference noise: "個|个[ge4]" → "个", "兩個|两个" → "两个", "[Bao1]" → "". The app is simplified-only. */
function clean(sense: string): string {
  return sense
    // "(" and ":" end the traditional form, so "(LT:張|张[zhang1])" keeps its "(LT:" and is dropped as a classifier.
    .replace(/[^\s\[\]/|(:]+\|(?=[^\s\[\]/|(:])/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// No \b after Vietnamese words: JS treats "ọ" as a non-word char, so /họ\b/ would match "học".
const NOISE = /^(LT:|Lượng từ:|biến thể|cách viết cũ|dạng cổ|họ \[|họ$|viết tắt|xem \S*\p{Script=Han}|như \p{Script=Han}|cũng viết|cũng đọc|tên riêng|phiên âm)/iu;
const REFERENCE = /(?:xem|biến thể[^[\]/]*? của|như|cũng viết là)\s+(?:[^\s[\]|/]+\|)?([^\s[\]|/]+)\[([^\]]+)\]/;

/** For stub entries ("xem 幹嘛|干嘛[gan4 ma2]"), the simplified target and its pinyin. */
export function referenceOf(entry: CedictEntry): { simp: string; numeric: string[] } | null {
  if (usableSenses(entry.senses).length) return null;
  for (const s of entry.senses) {
    const m = REFERENCE.exec(s);
    if (m) return { simp: m[1], numeric: m[2].split(' ') };
  }
  return null;
}

function usableSenses(senses: string[]): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const raw of senses) {
    const s = clean(raw);
    if (!s || NOISE.test(s)) continue;
    const unwrapped = /^\(([^()]*)\)$/.test(s) ? s.slice(1, -1) : s;
    for (const part of unwrapped.split(/;\s*/)) {
      // Classifier lists ("CL:個|个[ge4]" → "个", "(LT: 场个)") are not meanings.
      const p = part.replace(/\s*\((LT|Lượng từ):[^)]*\)/g, '').trim();
      if (/^[\p{Script=Han},，、\s]+$/u.test(p)) continue;
      const key = p.toLowerCase();
      if (p && !seen.has(key)) { seen.add(key); items.push(p); }
    }
  }
  return items;
}

/** Up to three senses, kept under `max` chars, never cutting a sense in half unless it's the only one. */
export function shortGloss(senses: string[], max = 32): string {
  const items = usableSenses(senses);
  if (!items.length) return '';
  const picked: string[] = [];
  for (const item of items) {
    const next = [...picked, item].join('; ');
    if (picked.length && next.length > max) break;
    picked.push(item);
    if (picked.length === 3) break;
  }
  const out = picked.join('; ');
  if (out.length <= max + 8) return out;
  const cut = out.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : max).replace(/[,;:\s]+$/, '') + '…';
}

/** All senses, cut after the last whole sense that fits in `max`; a single long sense is cut at a word like shortGloss. */
export function fullGloss(senses: string[], max = 220): string {
  const out = usableSenses(senses).join('; ');
  if (out.length <= max) return out;
  const lastSense = out.lastIndexOf(';', max);
  if (lastSense > 0) return out.slice(0, lastSense);
  const lastSpace = out.lastIndexOf(' ', max);
  return out.slice(0, lastSpace > 0 ? lastSpace : max).replace(/[,;:\s]+$/, '') + '…';
}
