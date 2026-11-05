// First start: the home page greets, shows the stats and the quick-start cards.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main');
  await t.step('home renders', async () => {
    await t.waitFor(main, '.page h1');
    const h1 = await t.text(main, '.page h1');
    t.assert(/Chào buổi (sáng|chiều|tối)/.test(h1 ?? ''), `greeting missing, got "${h1}"`);
    t.assert((await main.$$('.stats .stat')).length === 4, 'expected 4 stat cards');
    const actions = await t.texts(main, '.grid .action b');
    t.assert(actions.includes('Đoán nghĩa') && actions.includes('Ôn tập'), `quick-start cards: ${actions}`);
    t.assert((await t.calls(main, 'plugin:window|show')).length === 1, 'main window was not shown');
  });
}
