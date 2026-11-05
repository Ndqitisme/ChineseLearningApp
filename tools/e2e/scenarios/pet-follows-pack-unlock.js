// The assistant starts with HSK 4 unreadable. Then the main window unlocks HSK 5, and the assistant follows without a restart.
import { readFileSync } from 'node:fs';

const p4 = JSON.parse(readFileSync('src/generated/hsk4.json', 'utf8'));
const p5 = JSON.parse(readFileSync('src/generated/hsk5.json', 'utf8'));
const packHanzi = new Set([...p4.words, ...p5.words].map((w) => w.hanzi));
const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);

export const seed = { 'settings.json': { settings: { settingsVersion: 3, hskOpen: 4, hsk: [4], topics: [], onboarded: true } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const check = (cond, msg) => { if (!cond) t.problems.push(`assertion: ${msg}`); };
  const cdp = await pet.createCDPSession();
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
  const bubbles = async (n) => {
    const seen = [];
    for (let i = 0; i < n; i++) {
      await t.emitTo(pet, 'pet', 'tray:command', 'next');
      await wait(pet, 1800);
      seen.push((await t.text(pet, '.bubble .hanzi')) ?? `nap:${await t.text(pet, '.nap')}`);
    }
    return seen;
  };

  await t.step('P1 pet starts with HSK 4 unreadable', async () => {
    await t.reload('pet');
    await wait(pet, 500);
    console.log(`      pet with HSK 4 failed: ${JSON.stringify(await bubbles(2))}`);
    dropPackNoise();
  });

  const main = await t.open('main', '#/topics');
  await t.step('P2 pack readable again; main unlocks HSK 5 and turns the HSK 5 bell on', async () => {
    block = false;
    await t.click(main, '.topic.locked button');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 5);
    await wait(main, 400);
    await (await main.$('a[href="#/hsk/5"]')).evaluate((a) => a.parentElement.querySelector('.bell').click());
    await wait(main, 600);
    const s = (await t.store(main, 'settings.json')).settings;
    console.log(`      saved: hskOpen ${s.hskOpen} hsk ${JSON.stringify(s.hsk)}`);
    dropPackNoise();
  });

  await t.step('P3 pet follows the unlock without a restart', async () => {
    const seen = await bubbles(6);
    const res = await pet.evaluate(() => performance.getEntriesByType('resource').filter((e) => /hsk[45]\.json/.test(e.name)).map((e) => e.name.split('/').pop()));
    console.log(`      pet bubbles: ${JSON.stringify(seen)} · pet fetched ${JSON.stringify(res)}`);
    check(seen.some((h) => packHanzi.has(h)), `pet never showed an HSK 4/5 word after main unlocked HSK 5: ${JSON.stringify(seen)}`);
    dropPackNoise();
  });
}
