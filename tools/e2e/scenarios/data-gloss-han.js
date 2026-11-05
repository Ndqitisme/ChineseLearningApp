// Data audit: a pack meaning (vi) must not contain Han characters or end in an ellipsis.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const bad = [];
  for (const l of [4, 5, 6]) for (const w of t.packs[l]?.words ?? []) if (/[\u3400-\u9fff]/.test(w.vi) || /…$/.test(w.vi)) bad.push(w.hanzi);
  t.assert(bad.length === 0, `${bad.length} pack meanings with Han or "…": ${bad.slice(0, 12).join(' ')}...`);
}
