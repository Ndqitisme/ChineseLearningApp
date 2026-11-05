// Course pages and lesson decks list only the chosen edition's ids, in order. A lesson only the other edition has
// says so instead of serving another deck. Must match LESSON_SIZE in src/main/deck.ts.
const LESSON = 25;

export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const lists = { 2021: t.data.hsk, 2025: t.data.hsk2025 };
  const byId = new Map(t.data.words.map((w) => [w.id, w]));
  const setEdition = async (e) => {
    await go('#/settings/hsk');
    await t.click(main, '.chip', `Bản ${e}`);
    await main.waitForFunction((v) => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === v, { timeout: 5000 }, e);
  };
  const course = async (level) => {
    await go('#/');
    await go(`#/hsk/${level}`);
    await t.waitFor(main, 'details.lesson');
    return main.$$eval('details.lesson', (ds) => ds.map((d) => ({
      n: d.querySelector('summary b').textContent.trim(),
      ids: [...d.querySelectorAll('a.row')].map((a) => decodeURIComponent(a.getAttribute('href').replace('#/word/', ''))),
    })));
  };
  /** Prompts of one full quiz round (10 questions), answered with key 1. */
  const quizPrompts = async (hash) => {
    await go('#/');
    await go(hash);
    await t.waitFor(main, '.prompt');
    const seen = [];
    for (let i = 0; i < 10; i++) {
      const p = await t.text(main, '.prompt');
      if (!p) break;
      seen.push(p);
      await main.keyboard.press('1');
      await t.waitFor(main, '.next .btn');
      await main.keyboard.press('Enter');
      await main.waitForFunction((n) => !document.querySelector('.count') || !document.querySelector('.count').textContent.includes(`Câu ${n}/`), {}, i + 1);
    }
    return seen;
  };

  for (const e of [2021, 2025]) {
    for (const level of [1, 2, 3]) {
      await t.step(`${e} HSK ${level} course lists the ${e} ids in order`, async () => {
        await setEdition(e);
        const lessons = await course(level);
        const want = lists[e][level];
        const got = lessons.flatMap((l) => l.ids);
        t.assert(lessons.length === Math.ceil(want.length / LESSON), `${lessons.length} lessons for ${want.length} ids`);
        t.assert(JSON.stringify(got) === JSON.stringify(want), `HSK ${level} ${e}: ${got.length} rows vs ${want.length} ids; first diff at ${got.findIndex((id, i) => id !== want[i])}`);
        t.assert(lessons.every((l, i) => l.n === `Bài ${i + 1}`), `lesson titles ${lessons.map((l) => l.n)}`);
      });
    }

    await t.step(`${e} HSK 1 Bài 2 deck asks only Bài 2 words`, async () => {
      const slice = new Set(lists[e][1].slice(LESSON, 2 * LESSON).map((id) => byId.get(id).hanzi));
      const prompts = await quizPrompts('#/quiz/meaning/hsk/1/2');
      t.assert(prompts.length === 10, `round had ${prompts.length} questions`);
      const off = prompts.filter((h) => !slice.has(h));
      t.assert(!off.length, `${e} Bài 2 asked words outside that lesson: ${off}`);
      t.assert((await t.text(main, '.lead')).startsWith('HSK 1 · Bài 2'), `lead ${await t.text(main, '.lead')}`);
    });
  }

  await t.step('2025: a 2021-only lesson number says it does not exist', async () => {
    const last2021 = Math.ceil(t.data.hsk[1].length / LESSON);
    await go('#/');
    await go(`#/quiz/meaning/hsk/1/${last2021}`);
    await t.waitFor(main, 'p.empty', `HSK 1 không có Bài ${last2021}`);
    const href = await main.$eval('p.empty a', (a) => a.getAttribute('href'));
    t.assert(href === '#/hsk/1', `link ${href}`);
  });

  await t.step('2025: the whole HSK 3 course deck uses only 2025 HSK 3 words', async () => {
    const want = new Set(lists[2025][3].map((id) => byId.get(id).hanzi));
    const prompts = await quizPrompts('#/quiz/meaning/hsk/3');
    const off = prompts.filter((h) => !want.has(h));
    t.assert(!off.length, `HSK 3 deck asked ${off}`);
  });
}
