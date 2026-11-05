// Data audit: HSK 4-6 words whose Han Viet is shown but is not a real Vietnamese word with the same meaning.
import { readFileSync } from 'node:fs';
const wrong = '违反 喜剧 形容 起诉 分成 未来 气球 飞行员 冷静 居然 外界 除夕 著作 应对 制约 恋爱 超越 向上 改正 群体 高层 名人'.split(' ');

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const shown = new Map();
  for (const l of [4, 5, 6]) for (const w of t.packs[l]?.words ?? []) if (w.hanviet) shown.set(w.hanzi, w.hanviet);
  for (const w of t.data.words) if (w.hsk > 3 && w.hanviet) shown.set(w.hanzi, w.hanviet);
  const bad = wrong.filter((w) => shown.has(w));
  t.assert(bad.length === 0, `${bad.length}/${wrong.length} wrongly shown: ` + bad.map((w) => `${w}=${shown.get(w)}`).join(', '));
}
