// The assistant window follows an unlock made in the main window without a reload; the HSK 4 bell
// puts HSK 4 into her rotation; re-locking takes it out again, even when it was the only thing on.
import { readFileSync } from 'node:fs';

const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const p4 = JSON.parse(readFileSync('src/generated/hsk4.json', 'utf8'));
const coreHanzi = new Set(core.words.map((w) => w.hanzi));
const pack4 = new Set(p4.words.map((w) => w.hanzi));
const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

// The expected words below come from the 2021 lists.
export const seed = { 'settings.json': { settings: { hskEdition: 2021 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/topics');
  const check = (cond, msg) => { if (!cond) t.problems.push(`assertion: ${msg}`); };
  const settingsOf = async () => (await t.store(main, 'settings.json')).settings ?? {};
  const bubbleWords = async (n, stop) => {
    const seen = [];
    for (let i = 0; i < n; i++) {
      await t.emitTo(main, 'pet', 'tray:command', 'next');
      await wait(pet, 1800);
      const h = await t.text(pet, '.bubble .hanzi');
      seen.push(h);
      if (stop?.(seen)) break;
    }
    return seen;
  };
  const allBellsOff = async () => {
    for (;;) {
      const on = await main.$$('.topic .bell.on');
      if (!on.length) break;
      await on[0].click();
      await wait(main, 60);
    }
  };

  await t.step('6a pet has no HSK 4 pack before the unlock', async () => {
    await t.waitFor(pet, '.stage');
    const n = await pet.evaluate(() => performance.getEntriesByType('resource').filter((e) => /hsk4\.json/.test(e.name)).length);
    t.assert(n === 0, 'pet fetched HSK 4 while locked');
  });

  await t.step('10a unlock HSK 4 in main, bell on only HSK 4', async () => {
    await t.click(main, '.topic.locked button');
    await t.waitFor(main, 'a[href="#/hsk/4"] .count', `${p4.ids.length} từ`);
    await allBellsOff();
    await (await main.$('a[href="#/hsk/4"]')).evaluate((a) => a.parentElement.querySelector('.bell').click());
    await main.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings;
      return s && s.topics.length === 0 && JSON.stringify(s.hsk) === '[4]';
    });
    const title = await main.$eval('a[href="#/hsk/4"]', (a) => a.parentElement.querySelector('.bell').title);
    console.log(`      lead: ${await t.text(main, '.lead')} · bell title "${title}"`);
  });

  await t.step('6b pet shows an HSK 4 pack word without a reload', async () => {
    const seen = await bubbleWords(8, (s) => s.some((h) => pack4.has(h)));
    console.log(`      bubble: ${seen.join(' ')}`);
    t.assert(seen.some((h) => pack4.has(h)), `pet never showed an HSK 4 pack word: ${seen}`);
    t.assert(seen.every((h) => h && (pack4.has(h) || core.words.some((w) => w.hanzi === h && w.hsk === 4))), `bubble left HSK 4: ${seen}`);
  });

  await t.step('10b re-lock with only HSK 4 on: HSK 4 leaves the rotation', async () => {
    await go(main, '#/settings/hsk');
    await t.click(main, '.chip', 'HSK 1–3');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 3);
    t.assert(JSON.stringify((await settingsOf()).hsk) === '[]', `hsk ${JSON.stringify((await settingsOf()).hsk)}`);
    const seen = await bubbleWords(4);
    console.log(`      bubble after re-lock (nothing on): ${JSON.stringify(seen)}`);
    check(!seen.some((h) => h && pack4.has(h) && !coreHanzi.has(h)), `pet still shows HSK 4 words after re-lock: ${seen}`);
    await go(main, '#/topics');
    await t.waitFor(main, '.lead');
    console.log(`      topics lead: ${await t.text(main, '.lead')}`);
  });

  await t.step('10c bell on HSK 2 after re-lock: rotation is HSK 2', async () => {
    await (await main.$('a[href="#/hsk/2"]')).evaluate((a) => a.parentElement.querySelector('.bell').click());
    await main.waitForFunction(() => JSON.stringify(JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hsk) === '[2]');
    const hsk2 = new Set(core.words.filter((w) => w.hsk === 2).map((w) => w.hanzi));
    const seen = await bubbleWords(3);
    console.log(`      bubble: ${seen.join(' ')}`);
    t.assert(seen.every((h) => hsk2.has(h)), `bubble not HSK 2: ${seen}`);
  });
}
