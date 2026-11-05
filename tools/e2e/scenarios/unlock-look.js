// Screens of the course UI for a look at 860×600 and 1120×760, dark and light: locked cards,
// loading, a course page with lessons, the locked page and the Settings section.
export const seed = { 'settings.json': { settings: { settingsVersion: 3, mode: 'dark', onboarded: true } } };
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);
const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
const SIZES = [{ width: 860, height: 600 }, { width: 1120, height: 760 }];

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/topics');
  const both = async (name, prep) => {
    for (const size of SIZES) {
      await main.setViewport(size);
      if (prep) await prep();
      await settle(main);
      await t.step(`${name} ${size.width}`, async () => {});
    }
  };
  const scrollTo = (sel) => main.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);
  await t.step('course card clicked from the bottom of Topics opens at the top', async () => {
    await main.setViewport(SIZES[0]);
    await t.waitFor(main, 'a[href="#/hsk/3"]');
    await scrollTo('a[href="#/hsk/3"]');
    await settle(main);
    await main.click('a[href="#/hsk/3"]');
    await t.waitFor(main, '.lesson summary');
    await settle(main);
    const top = await main.$eval('h1', (h) => h.getBoundingClientRect().top);
    console.log(`      course title top after click: ${Math.round(top)}px`);
    if (top < 0) t.problems.push(`assertion: course page opens scrolled down (title at ${Math.round(top)}px), the practice buttons are off screen`);
  });
  for (const mode of ['dark', 'light']) {
    await go(main, '#/settings');
    await t.waitFor(main, '.chip', mode === 'dark' ? 'Tối' : 'Sáng').catch(() => {});
    await main.evaluate((m) => {
      const want = m === 'dark' ? 'Tối' : 'Sáng';
      [...document.querySelectorAll('.chip')].find((c) => c.innerText.trim().endsWith(want))?.click();
    }, mode);
    await main.waitForFunction((m) => document.documentElement.dataset.theme === m, {}, mode);
    if (mode === 'light') {
      await go(main, '#/settings/hsk');
      await t.click(main, '.chip', 'HSK 1–3');
      await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 3);
    }
    await go(main, '#/topics');
    await t.waitFor(main, '.topic.locked');
    await both(`${mode} topics locked`, () => scrollTo('.topic.locked'));
    await t.click(main, '.topic.locked button');
    await t.waitFor(main, 'a[href="#/hsk/4"] .count');
    await both(`${mode} topics after unlock 4`, () => scrollTo('.topic.locked'));
    await go(main, '#/hsk/5');
    await t.waitFor(main, '.empty');
    await both(`${mode} locked page`, () => scrollTo('h1, .empty'));
    await go(main, '#/settings/hsk');
    await t.waitFor(main, '#hsk');
    await both(`${mode} settings hsk`, () => scrollTo('#hsk'));
    await t.click(main, '.chip', 'HSK 1–6');
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.hskOpen === 6);
    await go(main, '#/hsk/6');
    await t.waitFor(main, '.lesson summary');
    await main.$$eval('.lesson', (els) => { els[0].open = true; });
    await both(`${mode} course page`, () => scrollTo('h1'));
  }
}
