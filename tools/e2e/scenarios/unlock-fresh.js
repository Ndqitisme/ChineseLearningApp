// HSK 4–6 on a fresh install: 1–3 open, 4–6 locked; unlocking 4 then 6 shows loading, counts and lessons of 25.
// Lesson quiz and write links serve exactly that lesson, and the state survives a reload of both windows.
const LESSON = 25;
const wait = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/topics');
  const settingsOf = async () => (await t.store(main, 'settings.json')).settings ?? {};
  const locked = () => main.$$eval('.topic.locked b', (els) => els.map((e) => e.textContent.trim()));
  const hints = () => main.$$eval('.topic.locked .small', (els) => els.map((e) => e.textContent.trim()));
  const count = (l) => t.text(main, `a[href="#/hsk/${l}"] .count`);
  const lessonsLine = (l) => main.$eval(`a[href="#/hsk/${l}"]`, (a) => a.querySelectorAll('.small')[0].textContent.trim()).catch(() => null);

  await t.step('1 fresh install: HSK 1-3 open, 4-6 locked with a free unlock button', async () => {
    await t.waitFor(main, '.topic.locked');
    t.assert(JSON.stringify(await locked()) === '["HSK 4","HSK 5","HSK 6"]', `locked: ${await locked()}`);
    for (const l of [1, 2, 3]) t.assert((await count(l)) === `${t.data.hsk[l].length} từ`, `HSK ${l} count ${await count(l)}`);
    const buttons = await t.texts(main, '.topic.locked button');
    t.assert(buttons.length === 3 && buttons.every((b) => b === 'Mở khoá'), `buttons: ${buttons}`);
    console.log(`      hints: ${JSON.stringify(await hints())}`);
    console.log(`      note: ${await t.text(main, '.unlock-note')}`);
    t.assert(JSON.stringify(await hints()) === '["Cấp tiếp theo","Mở kèm HSK 4","Mở kèm HSK 4–5"]', `hints ${await hints()}`);
    const packReq = await main.evaluate(() => performance.getEntriesByType('resource').filter((e) => /hsk[456]\.json/.test(e.name)).map((e) => e.name));
    t.assert(!packReq.length, `pack fetched while locked: ${packReq}`);
  });

  // Slow every pack so the loading state is observable.
  const cdp = await main.createCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*hsk4.json*' }, { urlPattern: '*hsk5.json*' }, { urlPattern: '*hsk6.json*' }] });
  cdp.on('Fetch.requestPaused', ({ requestId }) => setTimeout(() => cdp.send('Fetch.continueRequest', { requestId }).catch(() => {}), 900));

  await t.step('2 unlock HSK 4: loading, then the course with word and lesson counts', async () => {
    await t.click(main, '.topic.locked button');
    await t.waitFor(main, '.topic.locked button', 'Đang tải', 800);
    const disabled = await main.$$eval('.topic.locked button', (b) => b.map((x) => x.disabled));
    t.assert(disabled.every(Boolean), `other unlock buttons should be disabled while loading: ${disabled}`);
    const n = t.packs[4].ids.length;
    await t.waitFor(main, 'a[href="#/hsk/4"] .count', `${n} từ`);
    const line = await lessonsLine(4);
    t.assert(line === `${Math.ceil(n / LESSON)} bài, mỗi bài ${LESSON} từ`, `lesson line: ${line}`);
    t.assert(JSON.stringify(await locked()) === '["HSK 5","HSK 6"]', `locked: ${await locked()}`);
    t.assert((await settingsOf()).hskOpen === 4, 'hskOpen not saved as 4');
    t.assert(JSON.stringify(await hints()) === '["Cấp tiếp theo","Mở kèm HSK 5"]', `hints after 4: ${await hints()}`);
  });

  await t.step('3 unlock 6 from 4 opens 5 and 6 at once', async () => {
    const buttons = await main.$$('.topic.locked button');
    await buttons[1].click();
    await t.waitFor(main, '.topic.locked button', 'Đang tải', 800);
    await t.waitFor(main, 'a[href="#/hsk/6"] .count', `${t.packs[6].ids.length} từ`);
    t.assert((await count(5)) === `${t.packs[5].ids.length} từ`, `HSK 5 count ${await count(5)}`);
    t.assert(!(await main.$('.topic.locked')), 'a level is still locked');
    t.assert(!(await main.$('.unlock-note')), 'free-unlock note should go once everything is open');
    t.assert((await settingsOf()).hskOpen === 6, 'hskOpen not saved as 6');
  });
  await cdp.send('Fetch.disable');

  await t.step('7a lessons of 25 in frequency order on HSK 6', async () => {
    await go(main, '#/hsk/6');
    await t.waitFor(main, '.lesson summary', 'Bài 1');
    const ids = t.packs[6].ids;
    const all = new Map([...t.data.words, ...t.packs[4].words, ...t.packs[5].words, ...t.packs[6].words].map((w) => [w.id, w]));
    const summaries = await t.texts(main, '.lesson summary b');
    t.assert(summaries.length === Math.ceil(ids.length / LESSON), `lessons ${summaries.length}`);
    await main.$$eval('.lesson', (els) => els.forEach((d) => { d.open = true; }));
    const rows = await main.$$eval('.lesson', (els) => els.map((d) => [...d.querySelectorAll('a.row')].map((a) => a.getAttribute('href'))));
    for (let i = 0; i < rows.length; i++) {
      const want = ids.slice(i * LESSON, (i + 1) * LESSON).map((id) => `#/word/${id}`);
      const got = rows[i].map((h) => decodeURIComponent(h));
      t.assert(JSON.stringify(got) === JSON.stringify(want), `lesson ${i + 1} rows differ: ${got.slice(0, 3)} vs ${want.slice(0, 3)}`);
    }
    const last = rows.at(-1).length;
    console.log(`      HSK 6: ${rows.length} lessons, last has ${last} words`);
    const freqs = ids.map((id) => all.get(id)?.freq ?? Infinity);
    t.assert(freqs.every((f, i) => i === 0 || f >= freqs[i - 1]), 'ids not in frequency order');
  });

  await t.step('7b filter inside a course keeps lesson grouping', async () => {
    await main.$$eval('.lesson', (els) => els.forEach((d) => { d.open = false; }));
    const target = t.packs[6].words[30];
    await main.type('input[type=search]', target.hanzi);
    await t.waitFor(main, '.lesson[open] a.row', target.hanzi);
    const shown = await t.texts(main, '.lesson summary b');
    console.log(`      filter ${target.hanzi}: lessons shown ${shown}`);
    t.assert(shown.includes(`Bài ${Math.floor(t.packs[6].ids.indexOf(target.id) / LESSON) + 1}`), `filtered lesson ${shown}`);
  });

  await t.step('7c lesson quiz serves exactly that lesson (HSK 4 lesson 3)', async () => {
    const lesson = new Set(t.packs[4].ids.slice(2 * LESSON, 3 * LESSON));
    const byHanzi = new Map();
    for (const w of [...t.data.words, ...t.packs[4].words]) if (lesson.has(w.id)) byHanzi.set(w.hanzi, w.id);
    const prompts = new Set();
    for (let round = 0; round < 4; round++) {
      await go(main, '#/topics');
      await t.waitFor(main, '.topic');
      await go(main, '#/quiz/meaning/hsk/4/3');
      await t.waitFor(main, '.prompt');
      const lead = await t.text(main, '.lead');
      t.assert(lead.startsWith('HSK 4 · Bài 3'), `quiz title ${lead}`);
      for (let q = 0; q < 10; q++) {
        const p = await t.text(main, '.prompt');
        prompts.add(p);
        t.assert(byHanzi.has(p), `quiz asked ${p}, not in HSK 4 lesson 3`);
        await main.click('.option');
        await t.waitFor(main, '.next button');
        await main.click('.next button');
        await wait(main, 30);
      }
    }
    console.log(`      ${prompts.size} distinct prompts over 40 questions`);
  });

  await t.step('7d lesson write link serves that lesson (HSK 6 last lesson)', async () => {
    const n = Math.ceil(t.packs[6].ids.length / LESSON);
    const lesson = new Set(t.packs[6].ids.slice((n - 1) * LESSON));
    const hanzi = new Set([...t.data.words, ...t.packs[6].words].filter((w) => lesson.has(w.id)).map((w) => w.hanzi));
    await go(main, `#/write/hsk/6/${n}`);
    await t.waitFor(main, '.target .word');
    const lead = await t.text(main, '.lead');
    t.assert(lead.startsWith(`HSK 6 · Bài ${n}`), `write title ${lead}`);
    const w = (await t.text(main, '.target .word')).replace(/\s/g, '');
    t.assert(hanzi.has(w), `write shows ${w}, not in HSK 6 lesson ${n}`);
    await wait(main, 1500); // stroke data request
  });

  await t.step('7e lesson beyond the last one', async () => {
    await go(main, '#/quiz/meaning/hsk/4/99');
    await t.waitFor(main, '.empty');
    console.log(`      lesson 99: ${await t.text(main, '.lead')} / ${await t.text(main, '.empty')}`);
  });

  await t.step('7f About page counts match the open levels', async () => {
    await go(main, '#/about');
    await t.waitFor(main, 'b');
    const line = await main.evaluate(() => [...document.querySelectorAll('div')].find((d) => /^\d+ từ · \d+ chủ đề · HSK/.test(d.innerText.trim()))?.innerText.trim());
    console.log(`      About: ${line}`);
    if (line && /cấp 1–3/.test(line) && !line.startsWith(String(t.data.words.length))) {
      t.problems.push(`assertion: About says "${line}" with HSK 1–6 open (count includes 4–6, label says 1–3)`);
    }
  });

  await t.step('5 state persists across reload in both windows', async () => {
    await t.reload('pet');
    await t.reload('main');
    await go(main, '#/topics');
    await t.waitFor(main, 'a[href="#/hsk/6"] .count', `${t.packs[6].ids.length} từ`);
    t.assert(!(await main.$('.topic.locked')), 'locked after reload');
    await go(main, '#/settings/hsk');
    await t.waitFor(main, '.chip.on', 'HSK 1–6');
    // The pet reloaded with hskOpen 6, so it must have loaded the packs itself before mount.
    const petPacks = await pet.evaluate(() => performance.getEntriesByType('resource').filter((e) => /hsk[456]\.json/.test(e.name)).length);
    t.assert(petPacks >= 3, `pet loaded ${petPacks} packs after reload`);
  });
}
