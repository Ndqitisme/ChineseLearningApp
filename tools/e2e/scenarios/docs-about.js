// About page counts match the dataset, also after HSK 4-6 are opened: topic words plus the words the chosen
// edition (the 2025 default here) lists at an open level.
export const seed = { 'settings.json': { settings: { hskOpen: 6, settingsVersion: 3 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/about');
  await t.step('about line count and level text', async () => {
    await t.waitFor(main, '.counts', 'từ');
    const all = [...t.data.words, ...Object.values(t.packs).flatMap((p) => p.words)];
    const open = all.filter((w) => w.topics.length || w.hsk2025).length;
    const line = (await t.text(main, '.counts'))?.split('\n').map((x) => x.trim()).join(' · ');
    t.assert(line?.startsWith(`${open} từ`), `About says "${line}", expected ${open} words (topics + 2025 HSK 1–6)`);
    t.assert(line.includes('HSK 3.0 cấp 1–6') && line.includes('bộ từ bản 2025'), `About level text "${line}"`);
  });
}
