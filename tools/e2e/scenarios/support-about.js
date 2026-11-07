// Regression: About states the open HSK levels and word count truthfully before and after an unlock.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/about');
  const line = () => main.$eval('.page .counts', (d) => d.innerText.split('\n').map((x) => x.trim()).join(' · '));

  await t.step('R10 About before unlock', async () => {
    await t.waitFor(main, '.page h1', 'Giới thiệu');
    const l = await line();
    console.log(`      before: ${l}`);
    t.assert(l.includes('HSK 3.0 cấp 1–3'), `About line: ${l}`);
  });

  await t.step('R10 unlock HSK 1–6 in Settings', async () => {
    await main.evaluate(() => { location.hash = '#/settings/hsk'; });
    await t.click(main, 'button.chip', 'HSK 1–6');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 6, { timeout: 15000 });
  });

  await t.step('R10 About after unlock matches reality', async () => {
    await main.evaluate(() => { location.hash = '#/about'; });
    await t.waitFor(main, '.page h1', 'Giới thiệu');
    const l = await line();
    console.log(`      after: ${l}`);
    const n = Number(l.match(/^(\d+)/)?.[1]);
    const total = t.data.words.length + Object.values(t.packs).reduce((s, p) => s + p.words.length, 0);
    console.log(`      core ${t.data.words.length}, core+packs ${total}`);
    t.assert(!(n > t.data.words.length && l.includes('cấp 1–3')), `About says "${l}": ${n} words is more than HSK 1–3 has, yet the label says cấp 1–3`);
  });

  await t.step('R10 About after re-lock to 1–3', async () => {
    await main.evaluate(() => { location.hash = '#/settings/hsk'; });
    await t.click(main, 'button.chip', 'HSK 1–3');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 3, { timeout: 15000 });
    await main.evaluate(() => { location.hash = '#/about'; });
    await t.waitFor(main, '.page h1', 'Giới thiệu');
    const l = await line();
    console.log(`      after re-lock: ${l}`);
    // The core also holds 2021 HSK 1–3 words; with the default 2025 lists only topic words and 2025 HSK 1–3 count.
    const open13 = t.data.words.filter((w) => w.topics.length || (w.hsk2025 && w.hsk2025 <= 3)).length;
    t.assert(Number(l.match(/^(\d+)/)?.[1]) === open13, `after re-lock About still counts hidden words: ${l}`);
  });
}
