// New review cards: at most 10 a day, counted across sessions. A new card graded "Nhớ" comes back later in the
// same session (its next step is minutes away), and a fast double key press grades a card once.
import { readFileSync } from 'node:fs';

const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const nowMin = Date.now() / 60000;
// Twelve topic words the assistant has shown enough times, none with a review card yet.
const FRESH = core.topics.find((x) => x.id === 'greetings').words.slice(0, 12);
export const seed = {
  'settings.json': { settings: { settingsVersion: 4, onboarded: true, petEnabled: false } },
  'progress.json': { exposure: Object.fromEntries(FRESH.map((id, i) => [id, { n: 5, t: nowMin - 30 + i }])) },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/review');
  const reviewsToday = async () => Object.values((await t.store(main, 'progress.json')).reviewDays ?? {}).reduce((s, n) => s + n, 0);

  await t.step('10 new cards offered out of 12 words', async () => {
    t.assert(FRESH.length === 12, `greetings has ${FRESH.length} words`);
    await t.waitFor(main, '.status .remaining', 'Còn 10 thẻ cần ôn');
    await t.waitFor(main, 'nav .badge', '10');
  });

  await t.step('a new card graded "Nhớ" stays in the session; the day has 9 new cards left', async () => {
    await main.keyboard.press(' ');
    await t.waitFor(main, '.grades');
    await main.keyboard.press('3');
    await t.waitFor(main, '.status .remaining', 'Còn 10 thẻ cần ôn');
    await t.waitFor(main, 'nav .badge', '9');
  });

  await t.step('two fast presses of "3" grade one card once', async () => {
    await main.keyboard.press(' ');
    await t.waitFor(main, '.grades');
    await main.keyboard.press('3');
    await main.keyboard.press('3');
    await main.evaluate(() => new Promise((r) => setTimeout(r, 600)));
    t.assert((await reviewsToday()) === 2, `reviews saved today: ${await reviewsToday()}`);
  });

  await t.step('a new session the same day offers only what is left', async () => {
    await t.reload('main');
    await t.waitFor(main, 'nav .badge', '8');
    await t.waitFor(main, '.status .remaining', 'Còn 8 thẻ cần ôn');
  });
}
