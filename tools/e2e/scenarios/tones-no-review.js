// The tone drill keeps its own score only: checking tones writes no review card and no review count.
export const seed = { 'settings.json': { settings: { settingsVersion: 4, onboarded: true, petEnabled: false } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/tones/topic/greetings');

  await t.step('pick a tone for every syllable and check', async () => {
    await t.waitFor(main, '.syl');
    await main.$$eval('.syl', (ss) => ss.forEach((s) => s.querySelector('.tone')?.click()));
    await t.click(main, 'button', 'Kiểm tra');
    await t.waitFor(main, '.answer');
    await main.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    const p = await t.store(main, 'progress.json');
    t.assert(!Object.keys(p.srs ?? {}).length, `review cards written: ${JSON.stringify(p.srs)}`);
    t.assert(!Object.keys(p.reviewDays ?? {}).length, `review count written: ${JSON.stringify(p.reviewDays)}`);
  });

  await t.step('Back returns to the topic the drill came from', async () => {
    await main.click('.back-btn');
    await main.waitForFunction(() => location.hash === '#/topic/greetings', { timeout: 3000 });
  });
}
