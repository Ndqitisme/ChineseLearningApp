import { pinyin } from 'pinyin-pro';
import { isHan } from '../../src/lib/pinyin.ts';

/** Citation reading of 一 and 不 → the readings HSK books write when the tone changes. */
const CHANGES: Record<string, Record<string, string[]>> = { 一: { yi1: ['yi2', 'yi4'] }, 不: { bu4: ['bu2'] } };

/**
 * HSK books write the tone change of 一 and 不 (不客气 búkèqi, 一起 yìqǐ); the HSK list keeps the citation tone.
 * pinyin-pro decides where the change applies (it keeps yī in 第一, 一月, 统一). The changed tone follows the next
 * syllable as the list writes it, so 不一会儿 bùyìhuǐr agrees with its own huǐ; only before a neutral tone, whose
 * underlying tone the list does not give, is pinyin-pro's tone taken. Every other syllable keeps the list's reading:
 * pinyin-pro gives full tones where the list has neutral ones (客气 kèqi, 对不起 duìbuqǐ).
 * `numeric` has one syllable per Han character ("bu4", "ke4", "qi5"); a word in the override file stays as written.
 */
export function writeYiBuSandhi(hanzi: string, numeric: string[], overrides: ReadonlyMap<string, string>): string[] {
  if (overrides.has(hanzi) || !/[一不]/.test(hanzi)) return numeric;
  const chars = [...hanzi].filter(isHan);
  const spoken = pinyin(hanzi, { type: 'array', toneType: 'num', nonZh: 'removed' });
  return numeric.map((syl, i) => {
    if (!CHANGES[chars[i]]?.[syl]?.includes(spoken[i])) return syl;
    const next = Number(numeric[i + 1]?.at(-1));
    if (!(next >= 1 && next <= 4)) return spoken[i];
    const base = syl.slice(0, -1);
    if (chars[i] === '不') return next === 4 ? base + '2' : syl;
    return base + (next === 4 ? '2' : '4');
  });
}
