// Search finds words by toneless pinyin, by Hán Việt (with or without diacritics) and by hanzi.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/search');
  const search = async (q) => {
    await main.click('input.search', { count: 3 });
    await main.keyboard.press('Backspace');
    await main.type('input.search', q);
    await t.waitFor(main, '.muted', 'kết quả');
  };
  const top = () => t.text(main, '.list .row .hz');

  await t.step('pinyin without tones', async () => {
    await search('mifan');
    t.assert((await top()) === '米饭', `top result for mifan: ${await top()}`);
  });

  await t.step('Hán Việt with diacritics', async () => {
    await search('học sinh');
    t.assert((await top()) === '学生', `top result for học sinh: ${await top()}`);
    const hv = await main.$eval('.list .row .hv', (el) => el.textContent.trim());
    t.assert(hv === 'học sinh', `Hán Việt column: "${hv}"`);
  });

  await t.step('Hán Việt without diacritics', async () => {
    await search('dien thoai');
    t.assert((await top()) === '电话', `top result for dien thoai: ${await top()}`);
  });

  await t.step('hanzi', async () => {
    await search('电话');
    const all = await t.texts(main, '.list .row .hz');
    t.assert(all.length >= 1 && all.every((h) => h.includes('电话')), `hanzi results: ${all}`);
  });

  await t.step('no result says so', async () => {
    await search('qqqzzz');
    await t.waitFor(main, '.empty', 'Không tìm thấy');
  });
}
