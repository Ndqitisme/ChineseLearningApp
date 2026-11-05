// A settings toggle is saved, survives a reload, and reaches the assistant window.
/** @param {import('../run.ts').T} t */
export default async function (t) {
  const pet = await t.open('pet');
  const main = await t.open('main', '#/settings');
  const label = 'Hiện câu ví dụ trong bong bóng';
  const box = () => main.evaluateHandle((text) =>
    [...document.querySelectorAll('label')].find((l) => l.innerText.includes(text))?.querySelector('input'), label);
  const checked = async () => (await box()).evaluate((el) => el.checked);

  await t.step('example sentences are off by default', async () => {
    await t.waitFor(main, 'label', label);
    t.assert(!(await checked()), 'showExample should start off');
  });

  await t.step('toggle on', async () => {
    await (await box()).click();
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.showExample === true);
  });

  await t.step('still on after reload', async () => {
    await t.reload('main');
    await t.waitFor(main, 'label', label);
    t.assert(await checked(), 'showExample was lost on reload');
  });

  await t.step('assistant bubble shows the example', async () => {
    // The main window was used last; waits only poll in the front tab.
    await pet.bringToFront();
    await t.waitFor(pet, '.bubble .hanzi', undefined, 10_000);
    const hanzi = await t.text(pet, '.bubble .hanzi');
    const word = t.data.words.find((w) => w.hanzi === hanzi);
    t.assert(word, `bubble shows unknown word ${hanzi}`);
    if (word.ex) await t.waitFor(pet, '.bubble .ex', word.ex.vi);
    else console.log(`      (${hanzi} has no example sentence; nothing to show)`);
  });
}
