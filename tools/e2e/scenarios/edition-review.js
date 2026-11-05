// Due cards of a word the chosen edition does not list are skipped (queue, badge, Home, Practice, notebook) and
// come back when the edition switches back. Their progress is never touched.
const plain = (w) => !w.topics.length;
const day = 86_400_000;
const card = (reps, daysLate) => ({
  due: new Date(Date.now() - daysLate * day).toISOString(), stability: 3, difficulty: 5, elapsed_days: 3, scheduled_days: 3,
  learning_steps: 0, reps, lapses: 0, state: 2, last_review: new Date(Date.now() - (daysLate + 3) * day).toISOString(),
});

import { readFileSync } from 'node:fs';
const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const only2025 = core.words.find((w) => plain(w) && !w.hsk && w.hsk2025 === 3);
const only2021 = core.words.find((w) => plain(w) && w.hsk === 1 && !w.hsk2025);
const both = core.words.find((w) => plain(w) && w.hsk === 1 && w.hsk2025 === 1);
const nowMin = Math.floor(Date.now() / 60000);

export const seed = {
  'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false } },
  'progress.json': {
    // Most overdue first, so the queue's first card is the first one the chosen edition lists.
    srs: { [only2025.id]: card(5, 3), [only2021.id]: card(4, 2), [both.id]: card(3, 1) },
    exposure: { [only2025.id]: { n: 2, t: nowMin - 5, s: 1 }, [only2021.id]: { n: 2, t: nowMin - 4, s: 1 } },
  },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const setEdition = async (e) => {
    await go('#/settings/hsk');
    await t.click(main, '.chip', `Bản ${e}`);
    await main.waitForFunction((v) => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === v, { timeout: 5000 }, e);
  };
  const notebook = async () => {
    await go('#/notebook');
    await t.waitFor(main, 'a.row');
    return main.$$eval('a.row', (els) => els.map((a) => decodeURIComponent(a.getAttribute('href').replace('#/word/', ''))));
  };
  const expectEdition = async (e, first, hidden) => {
    await t.waitFor(main, 'nav .badge', '2');
    await go('#/');
    await t.waitFor(main, 'a.stat.link b');
    const due = await main.$eval('a.stat.link b', (b) => b.textContent.trim());
    t.assert(due === '2', `${e} Home due ${due}`);
    await go('#/practice');
    await t.waitFor(main, 'a', 'Ôn tập (2)');
    await go('#/review');
    await t.waitFor(main, '.flash .hz');
    const hz = await t.text(main, '.flash .hz');
    t.assert(hz === first.hanzi, `${e} first review card ${hz}, expected ${first.hanzi} (${hidden.hanzi} must be skipped)`);
    const nb = await notebook();
    t.assert(nb.includes(first.id), `${e} notebook ${nb}`);
    t.assert(!nb.includes(hidden.id), `${e} notebook shows ${hidden.id}`);
  };
  const progressKept = async () => {
    const p = await t.store(main, 'progress.json');
    t.assert(p.srs?.[only2025.id]?.reps === 5 && p.srs?.[only2021.id]?.reps === 4 && p.srs?.[both.id]?.reps === 3, `review cards changed: ${JSON.stringify(p.srs)}`);
    t.assert(p.exposure?.[only2025.id]?.s === 1 && p.exposure?.[only2021.id]?.s === 1, 'stars lost');
  };
  console.log(`      cards: ${only2025.hanzi} (2025 only), ${only2021.hanzi} (2021 only), ${both.hanzi} (both)`);

  await t.step('2021: two due, the 2025-only card is skipped', async () => expectEdition(2021, only2021, only2025));

  await t.step('2025: two due, the 2021-only card is skipped', async () => {
    await setEdition(2025);
    await expectEdition(2025, only2025, only2021);
    await progressKept();
  });

  await t.step('2025: grading the 2025-only card leaves the hidden one alone', async () => {
    await go('#/review');
    await t.waitFor(main, '.flash .hz', only2025.hanzi);
    await main.click('.flash');
    await main.keyboard.press('3');
    await main.waitForFunction((id) => JSON.parse(localStorage.getItem('e2e:store:progress.json') ?? '{}').srs?.[id]?.reps === 6, { timeout: 5000 }, only2025.id);
    const p = await t.store(main, 'progress.json');
    t.assert(p.srs[only2021.id].reps === 4 && p.srs[only2021.id].due === seed['progress.json'].srs[only2021.id].due, 'hidden card was changed');
    await t.waitFor(main, 'nav .badge', '1');
  });

  await t.step('back to 2021: the 2021-only card is due again, progress intact', async () => {
    await setEdition(2021);
    await t.waitFor(main, 'nav .badge', '2');
    await go('#/review');
    await t.waitFor(main, '.flash .hz', only2021.hanzi);
    const p = await t.store(main, 'progress.json');
    t.assert(p.srs[only2021.id].reps === 4 && p.srs[both.id].reps === 3 && p.srs[only2025.id].reps === 6, `srs ${JSON.stringify(p.srs)}`);
  });

  await t.step('reload under 2021: still no errors and the same queue', async () => {
    await t.reload('main');
    await t.waitFor(main, 'nav .badge', '2');
  });
}
