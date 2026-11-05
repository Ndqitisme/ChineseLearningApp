// HSK 4 pack unreadable at start-up: Topics explains it, a retry reports it, and HSK 4 unlocks again on the next good start.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, hskOpen: 4, hsk: [1, 4], onboarded: true } } };
const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/topics');
  const saved = async () => (await t.store(main, 'settings.json')).settings ?? {};
  const check = (cond, msg) => { if (!cond) t.problems.push(`assertion: ${msg}`); };
  const cdp = await main.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let block = true;
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*hsk4.json*' }] });
  cdp.on('Fetch.requestPaused', ({ requestId }) => (block
    ? cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' })
    : cdp.send('Fetch.continueRequest', { requestId })).catch(() => {}));
  const dropPackNoise = () => {
    for (let i = t.problems.length - 1; i >= 0; i--) {
      if (/hsk4\.json|Failed to load resource|Failed to fetch dynamically|HSK pack|error loading dynamically/i.test(t.problems[i])) t.problems.splice(i, 1);
    }
  };

  await t.step('F1 reload with HSK 4 unreadable: Topics explains', async () => {
    await t.reload('main');
    await go(main, '#/topics');
    await t.waitFor(main, '.bad', 'Không đọc được dữ liệu HSK 4');
    console.log(`      ${await t.text(main, '.bad')}`);
    console.log(`      saved after start: ${JSON.stringify({ hskOpen: (await saved()).hskOpen, hsk: (await saved()).hsk })}`);
    dropPackNoise();
  });

  await t.step('F2 retry while still unreadable shows an error', async () => {
    await t.click(main, '.topic.locked .btn');
    await t.waitFor(main, '.bad', 'Không mở khoá được');
    dropPackNoise();
  });

  await t.step('F3 toggling an unrelated bell during the failure, then a good start', async () => {
    await (await main.$('a[href="#/hsk/2"]')).evaluate((a) => a.parentElement.querySelector('.bell').click());
    await wait(main, 600);
    const s = await saved();
    console.log(`      saved after a bell toggle: hskOpen ${s.hskOpen} hsk ${JSON.stringify(s.hsk)}`);
    block = false;
    await t.reload('main');
    await go(main, '#/topics');
    await wait(main, 500);
    const open4 = !!(await main.$('a[href="#/hsk/4"]'));
    console.log(`      next good start: HSK 4 open ${open4}`);
    check(open4, `"tạm khoá lại" became permanent: a bell toggle saved hskOpen ${s.hskOpen}, HSK 4 is locked on the next good start`);
    dropPackNoise();
  });
  await cdp.send('Fetch.disable');
}
