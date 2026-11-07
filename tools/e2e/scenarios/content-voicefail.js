// "Nghe chọn chữ" on an HSK 5 lesson with a voice provider whose calls fail (the mock rejects every
// TTS command): the quiz still works, and the learner is told the sound could not play.
export const seed = { 'settings.json': { settings: { hskEdition: 2021, hskOpen: 5, hsk: [1], settingsVersion: 3, onboarded: true,
  speech: { provider: 'http', slot: 'female', voices: { female: '', male: '' }, rate: 0.9, autoplayInPet: false,
    http: { preset: 'openai', url: 'http://localhost:8880/v1/audio/speech', apiKey: '', model: 'kokoro', region: '' }, packDir: '' } } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const hsk5 = t.packs[5].ids.slice(0, 25);
  const all = [...t.data.words, ...[4, 5].flatMap((l) => t.packs[l].words)];
  const main = await t.open('main', '#/quiz/listen/hsk/5/1');

  await t.step('listen quiz answers still work with a failing voice', async () => {
    await t.waitFor(main, '.btn.listen');
    const options = await main.$$eval('.option', (os) => os.map((o) => o.innerText.replace(/^\d\s*/, '').trim()));
    t.assert(options.length === 4 && new Set(options).size === 4, `options ${options}`);
    t.assert(options.some((o) => all.some((w) => w.hanzi === o && hsk5.includes(w.id))), `no lesson word among ${options}`);
    await main.keyboard.press('1');
    await t.waitFor(main, '.option.right');
    const marked = await t.text(main, '.option.right .opt-han');
    t.assert(hsk5.includes(all.find((w) => w.hanzi === marked)?.id), `marked answer ${marked} is not a lesson word`);
  });

  await t.step('word page reports the same failure', async () => {
    const w = all.find((x) => x.id === hsk5[0]);
    await main.evaluate((h) => { location.hash = h; }, `#/word/${encodeURIComponent(w.id)}`);
    await t.click(main, '.btns .btn', 'Giọng nữ');
    await t.waitFor(main, '.bad.small');
  });
  await t.step('a failing voice is reported, not silent', async () => {
    await main.evaluate(() => { location.hash = '#/quiz/listen/hsk/5/1'; });
    await t.waitFor(main, '.btn.listen');
    await t.click(main, '.btn.listen', 'Nghe lại');
    await new Promise((r) => setTimeout(r, 600));
    const text = await t.text(main, '.page');
    t.assert(/không (phát|đọc|nghe)|lỗi|chưa (phát|đọc|cài)/i.test(text), 'a failing voice is silent with no message in "Nghe chọn chữ"');
  });

}
