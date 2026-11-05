// An install with HSK 4 open whose pack cannot be read at start-up: the main window should still
// come up (HSK 1–3 at least), not stay blank.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, hskOpen: 4, hsk: [1, 4], onboarded: true } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/topics');
  await t.step('starts with HSK 4 open', async () => {
    await t.waitFor(main, 'a[href="#/hsk/4"] .count', `${t.packs[4].ids.length} từ`);
  });
  const cdp = await main.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*hsk4.json*' }] });
  cdp.on('Fetch.requestPaused', ({ requestId }) => cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {}));

  await t.step('11e reload with the HSK 4 pack unreadable', async () => {
    let mounted = true;
    try { await t.reload('main'); } catch { mounted = false; }
    const body = await main.evaluate(() => document.body.innerText.trim().slice(0, 80));
    console.log(`      mounted: ${mounted}; body text: "${body}"`);
    for (let i = t.problems.length - 1; i >= 0; i--) {
      if (/hsk4\.json|Failed to load resource|Failed to fetch dynamically/.test(t.problems[i])) t.problems.splice(i, 1);
    }
    t.assert(mounted, 'main window stays blank when an open level pack fails at start-up');
  });
  await cdp.send('Fetch.disable');
}
