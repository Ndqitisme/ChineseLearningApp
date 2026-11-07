// Tone feedback without reference audio: compare the learner's pitch contour with the
// textbook shape of each tone (Chao tone letters, 1 = lowest … 5 = highest).
import type { Syllable, Tone } from './pinyin.ts';

export const TONE_SHAPE: Record<Tone, number[]> = {
  1: [5, 5, 5],
  2: [3, 4, 5],
  3: [2, 1, 4],
  4: [5, 3, 1],
  5: [3, 3, 3],
};

export const TONE_NAME: Record<Tone, string> = {
  1: 'thanh 1 (ngang, cao)',
  2: 'thanh 2 (đi lên)',
  3: 'thanh 3 (xuống rồi lên)',
  4: 'thanh 4 (đi xuống mạnh)',
  5: 'thanh nhẹ',
};

/**
 * Tones a learner may pick for each syllable: the written one, and the spoken one where tone sandhi changes it.
 * 不 is bú before a 4th tone; 一 is yí before a 4th or neutral tone and yì before the others; a 3rd tone before
 * another 3rd is said as a 2nd. Words list the citation tone (不对 bùduì), sometimes the spoken one (一样 yíyàng).
 */
export function acceptedTones(hanzi: string, syllables: Syllable[]): Tone[][] {
  const chars = [...hanzi];
  const aligned = chars.length === syllables.length;
  return syllables.map((s, i) => {
    const out = new Set<Tone>([s.tone]);
    const next = syllables[i + 1]?.tone;
    const ch = aligned ? chars[i] : '';
    if (ch === '不' && (s.tone === 4 || s.tone === 2)) {
      out.add(4);
      if (next === 4) out.add(2);
    }
    if (ch === '一' && s.tone !== 5) {
      out.add(1);
      if (next !== undefined) out.add(next === 4 || next === 5 ? 2 : 4);
    }
    if (s.tone === 3 && next === 3) out.add(2);
    return [...out].sort();
  });
}

export function resample(values: number[], n: number): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return Array(n).fill(values[0]);
  return Array.from({ length: n }, (_, i) => {
    const pos = (i * (values.length - 1)) / (n - 1);
    const lo = Math.floor(pos), hi = Math.min(values.length - 1, lo + 1);
    return values[lo] + (values[hi] - values[lo]) * (pos - lo);
  });
}

/** Template for a whole word on a 0–1 scale, `points` samples per syllable. */
export function template(tones: Tone[], points = 24): number[] {
  return tones.flatMap((t) => resample(TONE_SHAPE[t].map((v) => (v - 1) / 4), points));
}

/** Raw pitch (Hz, null when unvoiced) to a 0–1 contour: semitones, trimmed to the voiced span, scaled between the 10th and 90th percentile so speaker range doesn't matter. */
export function normalizeContour(hz: (number | null)[]): number[] {
  const voiced = hz.filter((v): v is number => v !== null && v > 0);
  if (voiced.length < 5) return [];
  const st = voiced.map((v) => 12 * Math.log2(v / 100));
  const sorted = [...st].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.floor(sorted.length * 0.9)];
  // A level tone has almost no range: keep it flat and high-ish instead of amplifying noise.
  if (hi - lo < 1.5) return st.map(() => 0.85);
  return st.map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
}

export interface ToneResult { score: number; perSyllable: number[]; contour: number[] }

/** Splits the contour evenly into syllables; each is scored 0–100 against its tone shape. */
export function scoreTones(hz: (number | null)[], tones: Tone[], points = 24): ToneResult {
  const contour = normalizeContour(hz);
  if (!contour.length || !tones.length) return { score: 0, perSyllable: tones.map(() => 0), contour };
  const per = contour.length / tones.length;
  const perSyllable = tones.map((t, i) => {
    const seg = resample(contour.slice(Math.floor(i * per), Math.max(Math.floor(i * per) + 2, Math.floor((i + 1) * per))), points);
    const tpl = resample(TONE_SHAPE[t].map((v) => (v - 1) / 4), points);
    if (t === 5) return 70; // neutral tone has no stable shape to judge
    // Compare shapes after removing each one's mean, so a whole-syllable offset isn't penalised.
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const ms = mean(seg), mt = mean(tpl);
    const diff = seg.reduce((s, v, k) => s + Math.abs(v - ms - (tpl[k] - mt)), 0) / points;
    return Math.round(Math.max(0, 1 - diff * 2.2) * 100);
  });
  return { score: Math.round(perSyllable.reduce((s, v) => s + v, 0) / tones.length), perSyllable, contour };
}
