// A level pack that fails to load: the Topics and Settings pages show their error line, nothing
// changes in settings, and a retry once the file is reachable unlocks the level.
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/topics');
  const settingsOf = async () => (await t.store(main, 'settings.json')).settings ?? {};
  const cdp = await main.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let blocked = 0;
  const block = async (patterns) => {
    cdp.removeAllListeners('Fetch.requestPaused');
    await cdp.send('Fetch.enable', { patterns: patterns.map((p) => ({ urlPattern: p })) });
    cdp.on('Fetch.requestPaused', ({ requestId }) => { blocked++; cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {}); });
  };
  /** The blocked request and the app's own console.error are what this scenario causes on purpose. */
  const expected = (re) => {
    const before = t.problems.length;
    for (let i = t.problems.length - 1; i >= 0; i--) if (re.test(t.problems[i])) t.problems.splice(i, 1);
    return before - t.problems.length;
  };

  await t.step('11a Topics: unlock HSK 4 with the pack blocked shows the error line', async () => {
    await block(['*hsk4.json*']);
    await t.click(main, '.topic.locked button');
    await t.waitFor(main, '.bad', 'Không mở khoá được');
    console.log(`      error line: ${await t.text(main, '.bad')} (blocked ${blocked} request)`);
    const buttons = await t.texts(main, '.topic.locked button');
    t.assert(buttons.every((b) => b === 'Mở khoá'), `buttons after failure: ${buttons}`);
    t.assert(!((await settingsOf()).hskOpen > 3), 'hskOpen changed although the pack failed');
    const removed = expected(/hsk4\.json|Failed to fetch dynamically imported module|console error: TypeError/);
    console.log(`      expected problems removed: ${removed}`);
  });

  await t.step('11b Topics: retry once the file is reachable', async () => {
    await cdp.send('Fetch.disable');
    await t.click(main, '.topic.locked button');
    try {
      await t.waitFor(main, 'a[href="#/hsk/4"] .count', `${t.packs[4].ids.length} từ`, 6000);
    } catch (e) {
      console.log(`      retry failed: ${await t.text(main, '.bad')} · problems: ${t.problems.join(' | ')}`);
      throw e;
    }
    t.assert(!(await main.$('.bad')), 'error line still shown after a successful retry');
    t.assert((await settingsOf()).hskOpen === 4, 'hskOpen not 4 after retry');
  });

  await t.step('11c Settings: unlock 1-6 with HSK 6 blocked, then retry', async () => {
    await go(main, '#/settings/hsk');
    await block(['*hsk6.json*']);
    await t.click(main, '.chip', 'HSK 1–6');
    await t.waitFor(main, '.bad', 'Không mở khoá được');
    const s = await settingsOf();
    console.log(`      after failure hskOpen=${s.hskOpen}; on chip: ${await t.text(main, '.chip.on')}`);
    t.assert(s.hskOpen === 4, `hskOpen ${s.hskOpen} after a failed 1–6`);
    expected(/hsk6\.json|Failed to fetch dynamically imported module|console error: TypeError/);
    await cdp.send('Fetch.disable');
    await t.click(main, '.chip', 'HSK 1–6');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 6, { timeout: 6000 })
      .catch(async () => { throw new Error(`retry in Settings failed: ${await t.text(main, '.bad')}`); });
    t.assert(!(await main.$('.bad')), 'Settings error line stays after a successful retry');
  });

  await t.step('11d pet window follows the retried unlock', async () => {
    await pet.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /hsk6\.json/.test(e.name)), { timeout: 5000 });
  });
  // Chrome logs each blocked request as its own console error, sometimes after the step ends.
  t.assert(expected(/\[main\] console error: Failed to load resource: net::ERR_FAILED/) <= 2, 'more failed loads than blocked requests');
}
