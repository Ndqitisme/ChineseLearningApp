// Drives the running verify build over CDP: loads, cross-window sync, ACL, disk writes.
// Usage: node verify.cjs <port> <dataDir> <shotDir> [phase]
const puppeteer = require('../../node_modules/puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const [port, dataDir, shotDir, phase = 'normal'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

const call = (page, cmd, args) => page.evaluate(async (cmd, args) => {
  try { return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(cmd, args) }; }
  catch (e) { return { ok: false, error: String(e) }; }
}, cmd, args);

async function listenChanges(page) {
  await page.evaluate(async () => {
    window.__changes = [];
    const handler = window.__TAURI_INTERNALS__.transformCallback((e) => window.__changes.push(e.payload));
    await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', { event: 'store:change', target: { kind: 'Any' }, handler });
  });
}

(async () => {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }); }
    catch { await sleep(500); }
  }
  if (!browser) throw new Error('no CDP');
  let main, pet;
  for (let i = 0; i < 40 && !(main && pet); i++) {
    for (const t of browser.targets()) {
      const url = t.url();
      if (url.includes('pet.html') && !pet) pet = await t.page();
      else if (url.includes('index.html') || /localhost\/?(#.*)?$/.test(url)) main ??= await t.page();
    }
    if (!(main && pet)) await sleep(500);
  }
  check('both windows present', !!main && !!pet, browser.targets().map((t) => t.url()).join(' | '));
  await sleep(3000);

  const fileProgress = JSON.parse(fs.readFileSync(path.join(dataDir, 'progress.json'), 'utf8'));
  for (const [name, page] of [['main', main], ['pet', pet]]) {
    const r = await call(page, 'store_load', { name: 'progress.json' });
    const keys = r.ok ? Object.keys(r.value).sort().join(',') : r.error;
    const srs = r.ok ? Object.keys(r.value.srs ?? {}).length : -1;
    check(`${name}: progress loads`, r.ok && srs === Object.keys(fileProgress.srs ?? {}).length, `keys=${keys} srsCards=${srs}`);
  }
  if (phase === 'corrupt') {
    const bak = JSON.parse(fs.readFileSync(path.join(dataDir, 'progress.json.bak'), 'utf8'));
    const r = await call(main, 'store_load', { name: 'progress.json' });
    check('restored content equals backup', JSON.stringify(r.value) === JSON.stringify(bak));
    check('damaged file kept aside', fs.existsSync(path.join(dataDir, 'progress.json.damaged')));
  }

  // Cross-window sync, both directions.
  await listenChanges(main);
  await listenChanges(pet);
  const stamp = Date.now();
  await call(main, 'store_set', { name: 'progress.json', key: 'verifyMain', value: stamp });
  await call(pet, 'store_set', { name: 'progress.json', key: 'verifyPet', value: stamp + 1 });
  await sleep(500);
  const seenByPet = await pet.evaluate(() => window.__changes);
  const seenByMain = await main.evaluate(() => window.__changes);
  check('pet sees main write', seenByPet.some((c) => c.key === 'verifyMain' && c.value === stamp), JSON.stringify(seenByPet));
  check('main sees pet write', seenByMain.some((c) => c.key === 'verifyPet' && c.value === stamp + 1), JSON.stringify(seenByMain));

  // App-level: settings written by main reach the pet's settings store.
  const before = await call(pet, 'store_load', { name: 'settings.json' });
  await sleep(2500);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'progress.json'), 'utf8'));
  check('write reaches disk', onDisk.verifyMain === stamp && onDisk.verifyPet === stamp + 1);
  check('backup exists after save', fs.existsSync(path.join(dataDir, 'progress.json.bak')));
  check('no temp left', !fs.existsSync(path.join(dataDir, 'progress.json.tmp')));
  check('settings readable from pet', before.ok, before.error ?? '');

  // Scope and ACL.
  const scope = await call(main, 'store_load', { name: '../../evil.json' });
  check('store refuses other paths', !scope.ok, scope.error);
  const pluginStore = await call(main, 'plugin:store|load', { path: 'C:/x.json', options: {} });
  check('plugin-store gone', !pluginStore.ok, pluginStore.error);
  for (const [who, page, cmd, args] of [
    ['main', main, 'pet_set_hit_rects', { rects: [] }],
    ['main', main, 'open_main', {}],
    ['pet', pet, 'voicepack_info', { dir: 'C:/' }],
    ['pet', pet, 'plugin:dialog|open', { options: {} }],
    ['pet', pet, 'plugin:opener|open_url', { url: 'https://example.com' }],
    ['pet', pet, 'plugin:window|close', { label: 'pet' }],
    ['pet', pet, 'plugin:autostart|is_enabled', {}],
  ]) {
    const r = await call(page, cmd, args);
    check(`${who} denied ${cmd}`, !r.ok && /not allowed|denied|permission/i.test(r.error), r.error ?? 'allowed!');
  }
  for (const [who, page, cmd, args] of [
    ['pet', pet, 'system_state', {}],
    ['pet', pet, 'pet_set_hit_rects', { rects: [{ x: 0, y: 0, w: 340, h: 330 }] }],
    ['main', main, 'voicepack_info', { dir: 'C:/definitely-missing' }],
    ['main', main, 'plugin:autostart|is_enabled', {}],
  ]) {
    const r = await call(page, cmd, args);
    const allowed = r.ok || !/not allowed|denied|permission/i.test(r.error);
    check(`${who} allowed ${cmd}`, allowed, r.ok ? JSON.stringify(r.value) : r.error);
  }
  // Restore the hit rects the pet set itself on its next layout.
  const geo = await main.evaluate(() => ({ outerW: outerWidth, outerH: outerHeight, sx: screenX, sy: screenY, availW: screen.availWidth, availH: screen.availHeight, availTop: screen.availTop, dpr: devicePixelRatio }));
  check('main window inside work area', geo.sx >= 0 && geo.sy >= geo.availTop && geo.sx + geo.outerW <= geo.availW && geo.sy + geo.outerH <= geo.availTop + geo.availH, JSON.stringify(geo));

  await main.screenshot({ path: path.join(shotDir, `main-${phase}.png`) });
  await pet.screenshot({ path: path.join(shotDir, `pet-${phase}.png`), omitBackground: true });
  browser.disconnect();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
