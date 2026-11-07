// Under 2025, unlocking HSK 4 on Topics loads pack 4 and its course lists the 2025 ids, including a word that is
// 2025 HSK 4 but 2021 HSK 6. Switching to 2021 serves the 2021 ids; that word's page stays open, since its 2025
// level is open.
import { readFileSync } from 'node:fs';

const p4 = JSON.parse(readFileSync('src/generated/hsk4.json', 'utf8'));
const moved = p4.words.find((w) => w.hsk === 6 && w.hsk2025 === 4 && !w.topics.length);
export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false, hskEdition: 2025 } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/topics');
  const packRequests = [];
  main.on('request', (r) => { if (/generated\/hsk[456]\.json/.test(r.url())) packRequests.push(r.url()); });
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const card = (level) => main.$$eval('.card.topic', (cs, l) => cs.find((c) => c.querySelector('b')?.textContent.trim() === `HSK ${l}`)?.innerText ?? '', level);
  const courseIds = async (level) => {
    await go('#/');
    await go(`#/hsk/${level}`);
    await t.waitFor(main, 'details.lesson');
    return main.$$eval('details.lesson a.row', (els) => els.map((a) => decodeURIComponent(a.getAttribute('href').replace('#/word/', ''))));
  };
  const open = async (id) => {
    await go('#/');
    await go(`#/word/${encodeURIComponent(id)}`);
    await main.waitForFunction((vi, hz) => document.querySelector('.hero .vi')?.textContent === vi || document.querySelector('p.empty')?.textContent.includes(hz),
      { timeout: 8000 }, moved.vi, moved.hanzi);
  };
  console.log(`      moved word: ${moved.hanzi} (2021 HSK 6, 2025 HSK 4); pack 4 ids ${p4.ids.length}, ids2025 ${p4.ids2025.length}`);

  await t.step('2025 with HSK 1–3: HSK 4 locked and no pack loaded', async () => {
    await t.waitFor(main, '.topic.locked b', 'HSK 4');
    t.assert(!packRequests.length, `packs loaded before unlocking: ${packRequests}`);
  });

  await t.step('unlock HSK 4 on Topics: pack 4 loads, the card lists 972 words', async () => {
    await go('#/topics');
    const locked = await main.$$('.topic.locked');
    await (await locked[0].$('button')).click();
    await t.waitFor(main, '.card.topic .count', `${p4.ids2025.length} từ`);
    t.assert((await card(4)).includes('972 từ'), `HSK 4 card ${await card(4)}`);
    t.assert(packRequests.some((u) => u.includes('hsk4')), `pack 4 not requested: ${packRequests}`);
    t.assert(!packRequests.some((u) => /hsk[56]/.test(u)), `extra packs: ${packRequests}`);
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 4, { timeout: 5000 });
  });

  await t.step('2025 HSK 4 course lists pack 4 ids2025 in order, with the moved word', async () => {
    const got = await courseIds(4);
    t.assert(got.length === 972, `HSK 4 course rows ${got.length}`);
    t.assert(JSON.stringify(got) === JSON.stringify(p4.ids2025), `rows differ from ids2025 at ${got.findIndex((id, i) => id !== p4.ids2025[i])}`);
    t.assert(got.includes(moved.id), `${moved.id} missing`);
  });

  await t.step('2025: the moved word shows HSK 4 and "Bản 2021: HSK 6"', async () => {
    await open(moved.id);
    await t.waitFor(main, '.chips .chip');
    const c = await t.texts(main, '.chips .chip');
    t.assert(c[0] === 'HSK 4' && c.includes('Bản 2021: HSK 6'), `chips ${c}`);
  });

  await t.step('switch to 2021: HSK 4 serves the 2021 ids; the moved word keeps its page (2025 HSK 4 is open)', async () => {
    await go('#/topics');
    await t.click(main, '.edition .chip', 'Bản 2021');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === 2021, { timeout: 5000 });
    const got = await courseIds(4);
    t.assert(JSON.stringify(got) === JSON.stringify(p4.ids), `2021 HSK 4 rows (${got.length}) differ from ids at ${got.findIndex((id, i) => id !== p4.ids[i])}`);
    t.assert(!got.includes(moved.id), `${moved.id} still in the 2021 HSK 4 course`);
    await open(moved.id);
    await t.waitFor(main, '.hero .vi', moved.vi);
    const c = await t.texts(main, '.chips .chip');
    t.assert(c[0] === 'HSK 6' && c.includes('Bản 2025: HSK 4'), `chips under 2021 ${c}`);
  });

  await t.step('restart under 2021 with HSK 1–4: pack 4 loads again, counts are right', async () => {
    await t.reload('main');
    await go('#/topics');
    await t.waitFor(main, '.card.topic .count', `${p4.ids.length} từ`);
    t.assert((await card(1)).includes(`${t.data.hsk[1].length} từ`), `HSK 1 ${await card(1)}`);
  });
}
