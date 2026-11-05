// Locked levels reached by URL: course page, practice decks, and word pages of locked-level words,
// before any unlock and after an unlock + re-lock in the same session. Nothing may crash.
import { readFileSync } from 'node:fs';

const core = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));
const p6 = JSON.parse(readFileSync('src/generated/hsk6.json', 'utf8'));
const p5 = JSON.parse(readFileSync('src/generated/hsk5.json', 'utf8'));
const w6 = p6.words.find((w) => !core.words.some((c) => c.hanzi.includes(w.hanzi)));
const topic5 = core.words.find((w) => w.hsk === 5 && w.topics.length);
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/');
  const check = (cond, msg) => { if (!cond) t.problems.push(`assertion: ${msg}`); };
  const hanzi5 = new Set([...p5.words.map((w) => w.hanzi)]);

  await t.step('8a #/hsk/5 while locked shows the locked message', async () => {
    await go(main, '#/hsk/5');
    await t.waitFor(main, '.empty', 'HSK 5 đang khoá');
    console.log(`      ${await t.text(main, '.empty')}`);
    t.assert(await main.$('.empty a[href="#/topics"]'), 'no link to the topics page');
    t.assert(!(await main.$('.lesson')), 'lessons shown for a locked level');
  });

  await t.step('8b #/hsk/7 and #/hsk/abc say not found', async () => {
    for (const h of ['#/hsk/7', '#/hsk/abc', '#/hsk/0']) {
      await go(main, h);
      await t.waitFor(main, '.empty', 'Không tìm thấy');
    }
  });

  await t.step('8c locked course practice links', async () => {
    for (const h of ['#/quiz/meaning/hsk/5', '#/quiz/meaning/hsk/5/1', '#/write/hsk/6/2', '#/tones/hsk/4', '#/build/order/hsk/6']) {
      await go(main, '#/');
      await go(main, h);
      await t.waitFor(main, '.lead');
      const lead = (await t.text(main, '.lead')).split(' · ')[0];
      const prompt = await t.text(main, '.prompt');
      console.log(`      ${h}: title "${lead}" prompt ${prompt ?? '-'} empty ${await t.text(main, '.empty') ?? '-'}`);
      check(!prompt || !hanzi5.has(prompt) || core.words.some((w) => w.hanzi === prompt), `${h} asked locked word ${prompt}`);
      check(/HSK [4-6]/.test(lead) || (await t.text(main, '.empty'))?.includes('khoá'), `${h} silently serves "${lead}" instead of saying the course is locked`);
    }
  });

  await t.step('9a word page of an HSK 6 word while locked', async () => {
    await go(main, `#/word/${encodeURIComponent(w6.id)}`);
    await t.waitFor(main, '.page');
    await main.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    const empty = await t.text(main, '.empty');
    console.log(`      #/word/${w6.id}: ${empty ?? (await t.text(main, '.hero'))?.slice(0, 60)}`);
    check(!empty?.startsWith('Không tìm thấy từ'), `a real HSK 6 word reads as "${empty}", nothing says HSK 6 is locked`);
  });

  await t.step('9b a topic word tagged HSK 5 links to the locked course', async () => {
    await go(main, `#/word/${encodeURIComponent(topic5.id)}`);
    await t.waitFor(main, '.chip', 'HSK 5');
    await t.click(main, '.chip', 'HSK 5');
    await t.waitFor(main, '.empty', 'HSK 5 đang khoá');
    console.log(`      ${topic5.hanzi} (${topic5.topics}) shows chip HSK 5 → locked page`);
  });

  await t.step('9c search for the HSK 6 word while locked', async () => {
    await go(main, `#/search/${w6.hanzi}`);
    await t.waitFor(main, '.empty', 'HSK 1–3');
  });

  await t.step('9d unlock 6 then re-lock: word page of the HSK 6 word', async () => {
    await go(main, '#/settings/hsk');
    await t.click(main, '.chip', 'HSK 1–6');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 6);
    await go(main, `#/word/${encodeURIComponent(w6.id)}`);
    await t.waitFor(main, '.hero');
    await go(main, '#/settings/hsk');
    await t.click(main, '.chip', 'HSK 1–3');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 3);
    await go(main, `#/word/${encodeURIComponent(w6.id)}`);
    await t.waitFor(main, '.page');
    await main.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    const hero = await main.$('.hero');
    const empty = await t.text(main, '.empty');
    console.log(`      after re-lock: ${hero ? 'full word page shown' : empty}`);
    check(!hero, `after re-lock the HSK 6 word page is still fully shown (search hides it, the word page does not)`);
    if (hero) {
      await t.click(main, '.chip', 'HSK 6');
      await t.waitFor(main, '.empty', 'HSK 6 đang khoá');
    }
  });

  await t.step('9e after reload while locked, the same link', async () => {
    await t.reload('main');
    await go(main, `#/word/${encodeURIComponent(w6.id)}`);
    await t.waitFor(main, '.page');
    await main.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    console.log(`      after reload: ${(await main.$('.hero')) ? 'full page' : await t.text(main, '.empty')}`);
    void pet;
  });
}
