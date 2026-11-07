// Re-locking HSK 1–5 to 1–3 hides HSK 4–5 everywhere (topics, search, decks, review, due counts, notebook,
// Home, assistant pool) but keeps their review cards and stars; unlocking again restores them.
import { readFileSync } from 'node:fs';

const pack = (l) => JSON.parse(readFileSync(`src/generated/hsk${l}.json`, 'utf8'));
const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const coreHanzi = new Set(core.words.map((w) => w.hanzi));
// Pack-only words of that level in the 2021 lists (seeded), whose characters appear in no core word,
// so a hanzi search cannot hit the core.
const only = (l) => pack(l).words.filter((w) => w.hsk === l && ![...coreHanzi].some((h) => h.includes(w.hanzi)));
const w5 = only(5);
const w4 = only(4);
const due5 = w5[0];
const due4 = w4[0];
const star5 = w5[1];
const seen5 = w5.slice(2, 14);
const nowMin = Math.floor(Date.now() / 60000);
const day = 86_400_000;
const card = (reps) => ({
  due: new Date(Date.now() - day).toISOString(), stability: 3, difficulty: 5, elapsed_days: 3, scheduled_days: 3,
  learning_steps: 0, reps, lapses: 0, state: 2, last_review: new Date(Date.now() - 4 * day).toISOString(),
});
const exposure = { [star5.id]: { n: 1, t: nowMin - 500, s: 1 } };
seen5.forEach((w, i) => { exposure[w.id] = { n: 1, t: nowMin - i }; });

export const seed = {
  'settings.json': { settings: { hskEdition: 2021, settingsVersion: 3, hskOpen: 5, hsk: [1, 5], topics: ['greetings'], onboarded: true } },
  'progress.json': { srs: { [due5.id]: card(3), [due4.id]: card(4) }, exposure },
};

const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);
const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/');
  // A finding that should not stop the rest of the run: recorded as a scenario problem.
  const check = (cond, msg) => { if (!cond) t.problems.push(`assertion: ${msg}`); };
  const settingsOf = async () => (await t.store(main, 'settings.json')).settings ?? {};
  const hidden = new Set([...pack(4).words, ...pack(5).words].map((w) => w.hanzi));
  // Search, review and the notebook keep words either edition lists at an open level: a 2021 HSK 4 word that the
  // 2025 lists put at HSK 1–3 stays visible after the re-lock.
  const stillOpen = (w) => w.topics.length || (w.hsk2025 && w.hsk2025 <= 3);
  const hiddenIds = new Set([...pack(4).ids, ...pack(5).ids].filter((id) => !core.words.some((w) => w.id === id && stillOpen(w))));
  const rowIds = async () => (await main.$$eval('a.row', (els) => els.map((a) => decodeURIComponent(a.getAttribute('href').replace('#/word/', '')))));
  const homeDue = () => main.$eval('a.stat.link b', (b) => b.textContent.trim());
  const bubbleWords = async (n) => {
    const seen = [];
    for (let i = 0; i < n; i++) {
      await t.emitTo(main, 'pet', 'tray:command', 'next');
      await wait(pet, 1800);
      const h = await t.text(pet, '.bubble .hanzi');
      if (h) seen.push(h);
    }
    return seen;
  };
  console.log(`      seeded: due ${due5.hanzi}(5) ${due4.hanzi}(4), star ${star5.hanzi}, seen ${seen5.map((w) => w.hanzi).join('')}`);

  await t.step('before: HSK 4-5 cards count, notebook and decks show them', async () => {
    await t.waitFor(main, 'nav .badge', '2');
    t.assert((await homeDue()) === '2', `Home due ${await homeDue()}`);
    await go(main, '#/notebook');
    await t.waitFor(main, 'a.row', star5.hanzi);
    await go(main, '#/quiz/meaning');
    await t.waitFor(main, '.prompt');
    t.assert((await t.text(main, '.lead')).startsWith('Từ đã gặp'), `default deck ${await t.text(main, '.lead')}`);
  });

  await t.step('4a re-lock to HSK 1-3 in Settings', async () => {
    await go(main, '#/settings/hsk');
    await t.click(main, '.chip', 'HSK 1–3');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 3);
    const s = await settingsOf();
    t.assert(JSON.stringify(s.hsk) === '[1]', `assistant levels after re-lock ${JSON.stringify(s.hsk)}`);
    t.assert(!(await main.$('nav .badge')), 'badge still shows after re-lock');
    const p = await t.store(main, 'progress.json');
    t.assert(p.srs[due5.id]?.reps === 3 && p.srs[due4.id]?.reps === 4, 'review cards lost on re-lock');
    t.assert(p.exposure[star5.id]?.s === 1, 'star lost on re-lock');
  });

  await t.step('4b topics page: 4-6 locked again', async () => {
    await go(main, '#/topics');
    await t.waitFor(main, '.topic.locked');
    const locked = await main.$$eval('.topic.locked b', (els) => els.map((e) => e.textContent.trim()));
    t.assert(JSON.stringify(locked) === '["HSK 4","HSK 5","HSK 6"]', `locked ${locked}`);
    console.log(`      lead: ${await t.text(main, '.lead')}`);
  });

  await t.step('4c search hides HSK 4-5 words (hanzi, pinyin, Vietnamese)', async () => {
    await go(main, `#/search/${due5.hanzi}`);
    await t.waitFor(main, '.empty', 'HSK 1–3');
    console.log(`      ${await t.text(main, '.empty')}`);
    for (const q of [due5.pinyin, due4.vi.split(/[;,]/)[0]]) {
      await go(main, '#/topics');
      await go(main, `#/search/${q}`);
      await t.waitFor(main, 'p.muted', 'kết quả');
      const leak = (await rowIds()).filter((id) => hiddenIds.has(id));
      t.assert(!leak.length, `search "${q}" shows locked words ${leak.slice(0, 5)}`);
    }
  });

  await t.step('4d review queue, Home and Practice due counts', async () => {
    await go(main, '#/review');
    await t.waitFor(main, '.empty-card');
    await go(main, '#/');
    await t.waitFor(main, 'a.stat.link b');
    t.assert((await homeDue()) === '0', `Home due ${await homeDue()}`);
    const recent = await rowIds();
    t.assert(!recent.some((id) => hiddenIds.has(id)), `Home recent shows locked words ${recent}`);
    console.log(`      Home familiar stat: ${await main.$eval('.stat b', (b) => b.textContent)}; recent rows ${recent.length}`);
    await go(main, '#/practice');
    await t.waitFor(main, 'a', 'Ôn tập (0)');
  });

  await t.step('4e notebook hides the starred HSK 5 word', async () => {
    await go(main, '#/notebook');
    await t.waitFor(main, '.empty');
  });

  await t.step('4f HSK 5 course deck URL no longer serves HSK 5', async () => {
    await go(main, '#/quiz/meaning/hsk/5');
    await t.waitFor(main, '.lead');
    const lead = await t.text(main, '.lead');
    const prompt = await t.text(main, '.prompt');
    console.log(`      #/quiz/meaning/hsk/5 while locked: "${lead}" prompt ${prompt} empty "${await t.text(main, '.empty')}"`);
    t.assert(!prompt || !hidden.has(prompt) || coreHanzi.has(prompt), `locked deck asked ${prompt}`);
    check(!lead.startsWith('Từ đang học') && !lead.startsWith('Từ Tiểu Mai'), `a locked course link silently serves another deck: ${lead}`);
  });

  await t.step('4g default practice deck still playable after re-lock', async () => {
    await go(main, '#/');
    await go(main, '#/quiz/meaning');
    await t.waitFor(main, '.lead');
    const empty = await t.text(main, '.empty');
    console.log(`      #/quiz/meaning after re-lock: "${await t.text(main, '.lead')}" empty: ${empty}`);
    check(!empty, `default quiz has no words after re-lock: ${empty}`);
  });

  await t.step('10 assistant pool drops HSK 4-5 after re-lock', async () => {
    const seen = await bubbleWords(6);
    console.log(`      bubble: ${seen.join(' ')}`);
    const leak = seen.filter((h) => hidden.has(h) && !coreHanzi.has(h));
    t.assert(!leak.length, `assistant still shows locked words ${leak}`);
  });

  await t.step('4h unlock again: cards, star and badge come back', async () => {
    await go(main, '#/settings/hsk');
    await t.click(main, '.chip', 'HSK 1–5');
    await t.waitFor(main, 'nav .badge', '2');
    await go(main, '#/notebook');
    await t.waitFor(main, 'a.row', star5.hanzi);
    await go(main, '#/review');
    await t.waitFor(main, '.flash .hz');
    const s = await settingsOf();
    console.log(`      after re-unlock hsk=${JSON.stringify(s.hsk)} (HSK 5 bell not restored)`);
  });
}
