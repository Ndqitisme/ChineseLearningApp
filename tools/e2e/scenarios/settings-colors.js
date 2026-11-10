// Colour overrides are kept per look. A version 3 save with one override map gets it in both looks; an edit in
// dark mode changes only the dark look, and Settings says which look it edits.
export const seed = {
  'settings.json': { settings: { settingsVersion: 3, onboarded: true, petEnabled: false, mode: 'light', tokenOverrides: { primary: '#ff0000' } } },
};

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/settings');
  const saved = async () => (await t.store(main, 'settings.json')).settings;
  const primary = () => main.evaluate(() => document.documentElement.style.getPropertyValue('--primary').trim());

  await t.step('the old map moves to both looks, version 4', async () => {
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.settingsVersion === 5, { timeout: 5000 });
    const s = await saved();
    t.assert(JSON.stringify(s.tokenOverrides) === '{"light":{"primary":"#ff0000"},"dark":{"primary":"#ff0000"}}', `overrides ${JSON.stringify(s.tokenOverrides)}`);
    t.assert((await primary()) === '#ff0000', `light --primary ${await primary()}`);
    await t.waitFor(main, 'p.muted', 'chỉ áp dụng cho chế độ sáng');
  });

  await t.step('an edit in dark mode changes only the dark look', async () => {
    await t.click(main, '.chip', 'Tối');
    await t.waitFor(main, 'p.muted', 'chỉ áp dụng cho chế độ tối');
    t.assert((await primary()) === '#ff0000', `dark --primary before the edit ${await primary()}`);
    await main.$$eval('label.color', (ls) => {
      const input = ls.find((l) => l.textContent.includes('Màu chính')).querySelector('input');
      input.value = '#00ff00';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await main.waitForFunction(() => JSON.parse(localStorage.getItem('e2e:store:settings.json') ?? '{}').settings?.tokenOverrides?.dark?.primary === '#00ff00', { timeout: 5000 });
    t.assert((await saved()).tokenOverrides.light.primary === '#ff0000', 'the light look changed too');
    t.assert((await primary()) === '#00ff00', `dark --primary ${await primary()}`);
  });

  await t.step('back to light: the light colour is still there', async () => {
    await t.click(main, '.chip', 'Sáng');
    await main.waitForFunction(() => document.documentElement.style.getPropertyValue('--primary').trim() === '#ff0000', { timeout: 3000 });
  });
}
