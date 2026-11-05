// A topic page lists its words with pinyin and meaning, and the filter narrows the list.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const topic = t.data.topics.find((x) => x.id === 'greetings');
  const main = await t.open('main', '#/topics');

  await t.step('topics list links to the topic', async () => {
    await t.click(main, 'a', topic.title);
    await t.waitFor(main, '.page h1', topic.title);
  });

  await t.step('topic lists its words', async () => {
    const rows = await t.texts(main, '.list .row .hz');
    t.assert(rows.length === topic.words.length, `expected ${topic.words.length} rows, got ${rows.length}`);
    t.assert(rows[0] === topic.words[0], `first row "${rows[0]}", expected "${topic.words[0]}"`);
    const vi = await t.text(main, '.list .row .vi');
    t.assert(vi === t.data.words.find((w) => w.id === topic.words[0]).vi, `meaning of first row: "${vi}"`);
  });

  await t.step('filter by meaning', async () => {
    await main.type('input[type=search]', 'cảm ơn');
    await t.waitFor(main, '.list .row .hz', '谢谢');
    const rows = await t.texts(main, '.list .row .hz');
    t.assert(rows.length >= 1 && rows.length < topic.words.length, `filter left ${rows.length} rows`);
  });

  await t.step('practice links carry the topic deck', async () => {
    const hrefs = await main.$$eval('.actions a.btn', (as) => as.map((a) => a.getAttribute('href')));
    t.assert(hrefs.includes('#/quiz/meaning/topic/greetings'), `quiz link: ${hrefs}`);
    t.assert(hrefs.includes('#/build/order/topic/greetings'), `build link: ${hrefs}`);
  });
}
