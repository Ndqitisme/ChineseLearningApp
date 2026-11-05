// Regression: settings.json on disk is not JSON at all (a torn write). The mock reads that as an empty store.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main');
  await t.step('R9 raw: write a torn settings file and restart', async () => {
    await main.evaluate(() => localStorage.setItem('e2e:store:settings.json', '{"settings":{"hsk":[1,2'));
    await t.reload('main');
    await t.waitFor(main, '.page h1');
    t.assert((await t.calls(main, 'plugin:window|show')).length >= 1, 'main window never shown');
  });
}
