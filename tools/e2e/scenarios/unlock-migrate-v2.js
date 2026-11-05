// A settings object saved by a v2 install (before HSK 4–6) keeps every choice the learner made,
// gains hskOpen 3 and settingsVersion 3, and the app shows HSK 1–3 with their own bells.
export const seed = {
  'settings.json': { settings: {
    settingsVersion: 2, theme: 'sakura', mode: 'dark', topics: ['drinks', 'office'], hsk: [2, 3], wordSec: 30,
    petScale: 2, showExample: true, guessFirst: false, onboarded: true, quietEnabled: true, quietFrom: '21:00',
    speech: { provider: 'system', rate: 1.1 },
  } },
};
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/settings/hsk');
  const saved = seed['settings.json'].settings;

  await t.step('12a v2 settings migrate to v3 and keep the choices', async () => {
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.settingsVersion === 3);
    const s = (await t.store(main, 'settings.json')).settings;
    for (const k of ['theme', 'mode', 'wordSec', 'petScale', 'showExample', 'guessFirst', 'onboarded', 'quietEnabled', 'quietFrom']) {
      t.assert(JSON.stringify(s[k]) === JSON.stringify(saved[k]), `${k}: ${JSON.stringify(s[k])} != ${JSON.stringify(saved[k])}`);
    }
    t.assert(JSON.stringify(s.topics) === '["drinks","office"]' && JSON.stringify(s.hsk) === '[2,3]', `topics/hsk ${s.topics} ${s.hsk}`);
    t.assert(s.speech.provider === 'system' && s.speech.rate === 1.1 && s.speech.http?.url, `speech ${JSON.stringify(s.speech)}`);
    t.assert(s.hskOpen === 3, `hskOpen ${s.hskOpen}`);
    t.assert(await main.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark mode lost');
    await t.waitFor(main, '.chip.on', 'HSK 1–3');
  });

  await t.step('12b topics shows bells for HSK 2 and 3 only', async () => {
    await go(main, '#/topics');
    await t.waitFor(main, '.topic.locked');
    const on = await main.$$eval('.topic .bell.on', (els) => els.map((b) => b.parentElement.querySelector('b').textContent.trim()));
    console.log(`      bells on: ${on}`);
    t.assert(on.includes('HSK 2') && on.includes('HSK 3') && !on.includes('HSK 1'), `bells ${on}`);
  });

  await t.step('12c reload keeps it (no second migration)', async () => {
    await t.reload('main');
    await t.reload('pet');
    const s = (await t.store(main, 'settings.json')).settings;
    t.assert(s.theme === 'sakura' && s.settingsVersion === 3 && s.hskOpen === 3, `after reload ${JSON.stringify({ theme: s.theme, v: s.settingsVersion, o: s.hskOpen })}`);
    await t.waitFor(pet, '.stage');
  });
}
