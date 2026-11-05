// Home stats and sentence building with HSK 1–6 open, then re-locked to 1–3: the due count and recent
// words follow the open levels; sentence building on an HSK 5 course still scores 100.
import { readFileSync } from 'node:fs';

const pack = (l) => JSON.parse(readFileSync(`src/generated/hsk${l}.json`, 'utf8'));
const [p4, p5, p6] = [pack(4), pack(5), pack(6)];
const d = new Date();
const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nowMin = Date.now() / 60000;
// A pack holds every word whose lowest level in either edition is that level; these runs use the 2021 lists.
const [w4, w5, w6] = [p4, p5, p6].map((p) => p.words.filter((w) => w.hsk === p.level));
const familiar = [w4[0], w5[0], w6[0]];
const learning = [w5[1], w6[1]];
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const card = { due: yesterday, stability: 3, difficulty: 5, elapsed_days: 3, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: yesterday };
export const seed = {
  'settings.json': { settings: { hskOpen: 6, hsk: [1], petEnabled: false, settingsVersion: 3, onboarded: true } },
  'progress.json': {
    exposure: Object.fromEntries([...familiar.map((w, i) => [w.id, { n: 5, t: nowMin - 10 - i }]), ...learning.map((w, i) => [w.id, { n: 1, t: nowMin - 1 - i }])]),
    srs: { [w5[2].id]: card, [w6[2].id]: card },
    seenDays: { [todayKey]: 7 },
  },
};
const SEPARATORS = /[\s，。？！、；：,.?!;:“”"'（）()…—~]+/g;

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const all = [...t.data.words, p4.words, p5.words, p6.words].flat();
  const main = await t.open('main');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const stats = () => main.$$eval('.stats .stat', (ss) => ss.map((s) => s.querySelector('b').textContent.trim()));

  await t.step('home stats count HSK 4–6 progress while open', async () => {
    await t.waitFor(main, '.stats .stat');
    const [seen, days, fam, due] = await stats();
    // Due counts the review session: 2 due cards plus the 3 familiar words that have no card yet.
    t.assert(seen === '7' && days === '1' && fam === '3' && due === '5', `stats seen/days/familiar/due = ${[seen, days, fam, due]}`);
    const recent = await main.$$eval('.recent .mini .hz', (els) => els.map((e) => e.textContent.trim()));
    t.assert(JSON.stringify(recent) === JSON.stringify([...learning, ...familiar].map((w) => w.hanzi)), `recent ${recent}`);
  });

  await t.step('sentence building on the HSK 5 course scores a right order 100', async () => {
    await go('#/build/order/hsk/5');
    await t.waitFor(main, '.pool .tile');
    const prompt = (await t.text(main, '.ask b')).replace(/^“|”$/g, '');
    const w = all.find((x) => x.ex?.vi === prompt);
    t.assert(w, `no example sentence means "${prompt}"`);
    let rest = w.ex.zh.replace(SEPARATORS, '');
    while (rest) {
      const tiles = await main.$$eval('.pool .tile', (ts) => ts.map((x) => ({ text: x.innerText.trim(), used: x.disabled })));
      const i = tiles.findIndex((x) => !x.used && rest.startsWith(x.text));
      t.assert(i >= 0, `no tile continues "${rest}" (${tiles.map((x) => x.text)})`);
      await (await main.$$('.pool .tile'))[i].click();
      rest = rest.slice(tiles[i].text.length);
    }
    await main.keyboard.press('Enter');
    await t.waitFor(main, '.points', '100');
  });

  await t.step('re-lock to 1–3: due and recent drop HSK 4–6', async () => {
    await go('#/settings/hsk');
    await t.click(main, '.chip', 'HSK 1–3');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json')).settings.hskOpen === 3);
    await go('#/');
    await t.waitFor(main, '.stats .stat');
    const [seen, , , due] = await stats();
    t.assert(seen === '7' && due === '0', `seen/due after re-lock ${seen}/${due}`);
    t.assert(!(await main.$('.recent .mini')), 'recent list still shows locked words');
    t.assert(await t.text(main, '.page .empty'), 'no empty-state line for the recent list');
  });

  await t.step('re-locked: "từ đã quen mặt" agrees with what is visible', async () => {
    const [, , fam] = await stats();
    t.assert(fam === '0', `familiar shows ${fam} while every familiar word is hidden`);
  });
}
