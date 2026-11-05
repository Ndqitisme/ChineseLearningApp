// Review with an HSK 4 card while HSK 1–4 are open: the badge counts it, the card flips to its pinyin,
// meaning and Hán Việt, and a grade schedules it. A due HSK 5 card (locked) is never shown but stays saved.
import { readFileSync } from 'node:fs';

const pack = (l) => JSON.parse(readFileSync(`src/generated/hsk${l}.json`, 'utf8'));
const four = pack(4).words.find((w) => w.hanviet && w.hanzi.length === 2);
const five = pack(5).words[0];
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const card = {
  due: yesterday, stability: 3, difficulty: 5, elapsed_days: 3, scheduled_days: 3,
  learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: new Date(Date.now() - 4 * 86_400_000).toISOString(),
};
export const seed = {
  'settings.json': { settings: { hskOpen: 4, hsk: [1], settingsVersion: 3, onboarded: true } },
  'progress.json': { srs: { [four.id]: card, [five.id]: card } },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/review');

  await t.step('due HSK 4 card is the only one counted and shown', async () => {
    await t.waitFor(main, '.flash .hz', four.hanzi);
    t.assert((await t.text(main, 'nav .badge')) === '1', `badge ${await t.text(main, 'nav .badge')}`);
    t.assert(!(await main.$('.back')), 'answer visible before flipping');
  });

  await t.step('flip shows pinyin, meaning and Hán Việt', async () => {
    await main.click('.flash');
    await t.waitFor(main, '.back .vi', four.vi);
    const py = (await t.text(main, '.back .py'))?.replace(/\s/g, '');
    t.assert(py === four.pinyin.replace(/\s/g, ''), `pinyin ${py}`);
    const back = await main.$eval('.back', (b) => b.textContent);
    t.assert(back.includes(four.hanviet), `Hán Việt "${four.hanviet}" missing on the back: "${back}"`);
  });

  await t.step('grade "Nhớ" schedules it; the locked HSK 5 card stays saved and hidden', async () => {
    await t.click(main, '.grades .btn', 'Nhớ');
    await t.waitFor(main, '.empty-card');
    const srs = (await t.store(main, 'progress.json')).srs;
    t.assert(Date.parse(srs[four.id].due) > Date.now() && srs[four.id].reps === 3, `HSK 4 card ${JSON.stringify(srs[four.id])}`);
    t.assert(srs[five.id]?.reps === 2, `HSK 5 card changed: ${JSON.stringify(srs[five.id])}`);
    t.assert(!(await main.$('nav .badge')), 'badge still shown');
  });

  await t.step('the empty state reads plainly', async () => {
    const text = await t.text(main, '.empty-card');
    t.assert(/Không còn thẻ cần ôn/.test(text), `empty text "${text}"`);
  });
}
