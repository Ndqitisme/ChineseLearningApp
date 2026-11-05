// Review: a due card shows the word only, flips to pinyin and meaning, and a grade schedules it
// into the future and empties the queue, which stays empty after a reload.
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
export const seed = {
  'progress.json': {
    srs: {
      学生: {
        due: yesterday, stability: 3, difficulty: 5, elapsed_days: 3, scheduled_days: 3,
        learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      },
    },
  },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const word = t.data.words.find((w) => w.id === '学生');
  const main = await t.open('main', '#/review');

  await t.step('due card shows the word only', async () => {
    await t.waitFor(main, '.flash .hz', word.hanzi);
    t.assert(!(await main.$('.back')), 'answer visible before flipping');
    t.assert((await t.text(main, 'nav .badge')) === '1', 'review badge should show 1 due card');
  });

  await t.step('flip shows pinyin and meaning', async () => {
    await main.click('.flash');
    await t.waitFor(main, '.back .vi', word.vi);
    t.assert((await t.text(main, '.back .py'))?.replace(/\s/g, '') === word.pinyin.replace(/\s/g, ''), 'pinyin on the back');
    t.assert((await main.$$('.grades .btn')).length >= 4, 'four grade buttons');
  });

  await t.step('grade "Nhớ" schedules the card', async () => {
    await t.click(main, '.grades .btn', 'Nhớ');
    await t.waitFor(main, '.empty-card', 'Không còn thẻ cần ôn');
    const card = (await t.store(main, 'progress.json')).srs['学生'];
    t.assert(Date.parse(card.due) > Date.now(), `card due ${card.due} is not in the future`);
    t.assert(card.reps === 3, `reps ${card.reps}`);
  });

  await t.step('still nothing due after reload', async () => {
    await t.reload('main');
    await t.waitFor(main, '.empty-card');
    t.assert(!(await main.$('nav .badge')), 'badge came back after reload');
  });
}
