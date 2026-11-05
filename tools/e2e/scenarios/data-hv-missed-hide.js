// Data audit: real Sino-Vietnamese words that are hidden as "ghép từng chữ".
const missed = { 宗教: 'tôn giáo', 诊断: 'chẩn đoán', 词汇: 'từ vựng', 激烈: 'kịch liệt', 公主: 'công chúa', 大使: 'đại sứ', 成分: 'thành phần', 效率: 'hiệu suất', 征服: 'chinh phục', 调动: 'điều động' };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const all = new Map();
  for (const l of [4, 5, 6]) for (const w of t.packs[l]?.words ?? []) all.set(w.hanzi, w);
  for (const w of t.data.words) all.set(w.hanzi, w);
  const bad = Object.keys(missed).filter((w) => !all.get(w)?.hanviet);
  t.assert(bad.length === 0, `${bad.length}/${Object.keys(missed).length} real words still hidden: ${bad.join(' ')}`);
}
