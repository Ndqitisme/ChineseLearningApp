// Tones and listening on HSK 5 words with no voice installed, then with a voice provider whose calls
// fail (the mock rejects every TTS command): nothing crashes, and the learner is told when a sound cannot play.
export const seed = { 'settings.json': { settings: { hskEdition: 2021, hskOpen: 5, hsk: [1], settingsVersion: 3, onboarded: true } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const all = [...t.data.words, ...[4, 5].flatMap((l) => t.packs[l].words)];
  const hsk5 = new Set(t.packs[5].ids);
  const main = await t.open('main', '#/tones/hsk/5');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const current = async () => {
    const hz = await t.text(main, '.drill .hz');
    return all.find((w) => w.hanzi === hz && hsk5.has(w.id));
  };

  await t.step('tones drill serves an HSK 5 word, no listen button without a voice', async () => {
    await t.waitFor(main, '.drill .hz');
    const w = await current();
    t.assert(w, `drill word ${await t.text(main, '.drill .hz')} is not HSK 5`);
    t.assert((await t.text(main, '.drill .vi')) === w.vi, 'meaning under the word');
    t.assert(!(await main.$('.drill .btn:not(.primary)')), '"Nghe mẫu" shown with no voice installed');
    t.assert((await main.$$('.syl')).length === w.syllables.length, 'one tone row per syllable');
  });

  // The drill keeps its own score only: picking tones says nothing about recalling the word, so no review card.
  await t.step('right tones are accepted and counted in the drill score, with no review card', async () => {
    const w = await current();
    const rows = await main.$$('.syl');
    for (const [i, s] of w.syllables.entries()) await (await rows[i].$$('.tone'))[s.tone - 1].click();
    await t.click(main, '.drill .btn.primary', 'Kiểm tra');
    await t.waitFor(main, '.drill .answer', 'Đúng');
    await t.waitFor(main, '.drill .muted', 'đúng 1');
    const card = (await t.store(main, 'progress.json')).srs?.[w.id];
    t.assert(card === undefined, `the drill wrote a review card: ${JSON.stringify(card)}`);
  });

  await t.step('wrong tones show the answer', async () => {
    await t.click(main, '.speak .btn', 'Từ tiếp');
    await main.waitForFunction(() => !document.querySelector('.drill .answer'));
    const w = await current();
    const rows = await main.$$('.syl');
    // Neutral tone for a toned syllable (tone 1 for a neutral one): never a sandhi reading the drill accepts.
    for (const [i, s] of w.syllables.entries()) await (await rows[i].$$('.tone'))[s.tone === 5 ? 0 : 4].click();
    await t.click(main, '.drill .btn.primary', 'Kiểm tra');
    await t.waitFor(main, '.drill .answer', 'Chưa đúng');
    const py = (await t.text(main, '.drill .answer .pinyin'))?.replace(/\s/g, '');
    t.assert(py === w.pinyin.replace(/\s/g, ''), `answer pinyin "${py}" vs "${w.pinyin}"`);
  });

  await t.step('recording without a microphone explains itself', async () => {
    await t.click(main, '.speak .btn', 'Ghi âm');
    await t.waitFor(main, '.speak .bad', 'micro');
  });

  await t.step('Practice sends "Nghe chọn chữ" to Settings when there is no voice', async () => {
    await go('#/practice');
    const href = await main.$$eval('.mode', (ms) => ms.find((m) => m.innerText.includes('Nghe chọn chữ'))?.getAttribute('href'));
    t.assert(href === '#/settings/voice', `listen card links to ${href}`);
  });

  await t.step('listen quiz opened directly with no voice says why it is silent', async () => {
    await go('#/quiz/listen/hsk/5/1');
    await t.waitFor(main, '.btn.listen');
    const text = await t.text(main, '.page');
    t.assert(/giọng|Cài đặt/i.test(text.replace(/Luyện tập/g, '')), 'listen quiz with no voice gives no hint that nothing will play');
  });

}
