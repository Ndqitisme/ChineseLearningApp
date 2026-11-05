// Edition switch on Topics and in Settings: the default is the 2021 lists. The choice is saved as a number, shows
// the same on both pages, survives a reload and fits a narrow window.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/topics');
  const go = (hash) => main.evaluate((h) => { location.hash = h; }, hash);
  const saved = async () => (await t.store(main, 'settings.json')).settings?.hskEdition;
  const waitSaved = (e) => main.waitForFunction((v) => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskEdition === v, { timeout: 5000 }, e);
  const counts = () => main.$$eval('.card.topic', (cs) => Object.fromEntries(cs
    .map((c) => [c.querySelector('b')?.textContent.trim(), c.querySelector('.count')?.textContent.trim()])
    .filter(([b, n]) => /^HSK \d$/.test(b ?? '') && n)));
  const onChip = () => main.$$eval('.chip.on', (cs) => cs.map((c) => c.textContent.trim()).filter((x) => x.startsWith('Bản')));
  const expect = (lists) => Object.fromEntries([1, 2, 3].map((l) => [`HSK ${l}`, `${lists[l].length} từ`]));

  await t.step('E1a default: Bản 2021 on, HSK 1–3 counts are the 2021 lists', async () => {
    await t.waitFor(main, '.edition .chip.on', 'Bản 2021');
    const c = await counts();
    t.assert(c['HSK 1'] === '506 từ', `HSK 1 count ${c['HSK 1']}`);
    t.assert(JSON.stringify(c) === JSON.stringify(expect(t.data.hsk)), `2021 counts ${JSON.stringify(c)}`);
    t.assert(JSON.stringify(await onChip()) === '["Bản 2021"]', `chips on ${await onChip()}`);
  });

  await t.step('E1b Bản 2025 on Topics: counts change and the choice is saved', async () => {
    await t.click(main, '.edition .chip', 'Bản 2025');
    await t.waitFor(main, '.card.topic .count', '294 từ');
    const c = await counts();
    t.assert(c['HSK 1'] === '294 từ' && c['HSK 3'] === '487 từ', `2025 counts ${JSON.stringify(c)}`);
    t.assert(JSON.stringify(c) === JSON.stringify(expect(t.data.hsk2025)), `2025 counts vs data ${JSON.stringify(c)}`);
    await waitSaved(2025);
    t.assert((await saved()) === 2025, `saved edition ${JSON.stringify(await saved())} (must be the number 2025)`);
    const card = await main.$$eval('.card.topic', (cs) => cs.find((c) => c.querySelector('b')?.textContent.trim() === 'HSK 1')?.innerText ?? '');
    t.assert(card.includes('12 bài'), `HSK 1 card under 2025: ${card}`);
  });

  await t.step('E1c the choice survives a restart', async () => {
    await t.reload('main');
    await t.waitFor(main, '.edition .chip.on', 'Bản 2025');
    t.assert((await counts())['HSK 1'] === '294 từ', `after reload ${JSON.stringify(await counts())}`);
  });

  await t.step('E2a Settings shows the same edition as Topics', async () => {
    await go('#/settings/hsk');
    await t.waitFor(main, '.chip.on', 'Bản 2025');
    t.assert(JSON.stringify(await onChip()) === '["Bản 2025"]', `Settings chips on ${await onChip()}`);
  });

  await t.step('E2b switching in Settings updates Topics', async () => {
    await t.click(main, '.chip', 'Bản 2021');
    await waitSaved(2021);
    t.assert(JSON.stringify(await onChip()) === '["Bản 2021"]', `Settings chips after click ${await onChip()}`);
    await go('#/topics');
    await t.waitFor(main, '.edition .chip.on', 'Bản 2021');
    t.assert((await counts())['HSK 1'] === '506 từ', `Topics after Settings switch ${JSON.stringify(await counts())}`);
  });

  await t.step('E2c clicking the chip already on keeps the edition', async () => {
    await t.click(main, '.edition .chip', 'Bản 2021');
    await main.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    t.assert((await saved()) === 2021, `edition after re-click ${await saved()}`);
    t.assert((await counts())['HSK 1'] === '506 từ', 'counts changed after re-click');
  });

  await t.step('E2d "Khác nhau thế nào?" opens the Settings explanation', async () => {
    await t.click(main, '.edition a', 'Khác nhau thế nào?');
    await main.waitForFunction(() => location.hash === '#/settings/hsk');
    await t.waitFor(main, 'p.muted', 'Bản 2025: đề cương');
  });

  for (const e of [2025, 2021]) {
    await t.step(`E10 narrow window ${e}: Topics fits`, async () => {
      await main.setViewport({ width: 860, height: 600 });
      await go('#/topics');
      await t.click(main, '.edition .chip', `Bản ${e}`);
      await waitSaved(e);
      await main.evaluate(() => document.querySelector('.edition')?.scrollIntoView());
      const box = await main.$eval('.edition', (el) => ({ right: el.getBoundingClientRect().right, vw: document.documentElement.clientWidth }));
      t.assert(box.right <= box.vw + 1, `edition row ends at ${box.right}px in a ${box.vw}px window`);
    });
    await t.step(`E10 narrow window ${e}: Settings fits`, async () => {
      await go('#/settings/hsk');
      await t.waitFor(main, '.chip.on', `Bản ${e}`);
      await main.evaluate(() => document.getElementById('hsk')?.scrollIntoView());
    });
  }
  await main.setViewport({ width: 1120, height: 760 });
}
