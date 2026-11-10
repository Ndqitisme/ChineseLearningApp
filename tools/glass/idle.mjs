// Idle repaint check: 10 s of a Chromium trace on the main window (three pages) and the assistant
// window (with and without the character), counting Paint / Layout / style / script events, plus
// Performance.getMetrics deltas. Usage: node idle.mjs
import { seedFor, sleep, start } from './harness.mjs';

const IDLE_MS = 10_000;
const COUNT = ['Paint', 'PrePaint', 'Layout', 'UpdateLayoutTree', 'Commit', 'CompositeLayers', 'UpdateLayerTree', 'FunctionCall', 'TimerFire', 'FireAnimationFrame', 'RasterTask', 'DrawFrame'];

async function measure(page, label, prepare) {
  await prepare?.();
  await page.evaluate(() => document.fonts.ready);
  await sleep(2500);
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await page.tracing.start({ categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'] });
  await sleep(IDLE_MS);
  const buf = await page.tracing.stop();
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const events = JSON.parse(new TextDecoder().decode(buf)).traceEvents;
  const counts = {};
  for (const e of events) if (COUNT.includes(e.name)) counts[e.name] = (counts[e.name] ?? 0) + 1;
  const d = (k) => +((after[k] ?? 0) - (before[k] ?? 0)).toFixed(3);
  console.log(`\n${label} (${IDLE_MS / 1000} s idle)`);
  console.log('  trace events:', JSON.stringify(counts));
  console.log('  metrics delta:', JSON.stringify({ LayoutCount: d('LayoutCount'), RecalcStyleCount: d('RecalcStyleCount'), ScriptDuration: d('ScriptDuration'), TaskDuration: d('TaskDuration'), LayoutDuration: d('LayoutDuration'), RecalcStyleDuration: d('RecalcStyleDuration') }));
  await cdp.detach();
  return counts;
}

const h = await start();
try {
  const main = await h.open({ hash: '#/', size: { width: 1120, height: 760 }, seed: seedFor({ theme: 'ocean', mode: 'light' }) });
  await main.page.waitForSelector('.rig[data-ready]', { timeout: 20_000 }).catch(() => console.log('  (rig not ready)'));
  await measure(main.page, 'main: home, sidebar character present');
  await measure(main.page, 'main: home, sidebar character removed', () => main.page.evaluate(() => document.querySelector('.me')?.remove()));
  await main.page.evaluate(() => { location.hash = '#/topics'; }); await sleep(500);
  await measure(main.page, 'main: topics (22 glass cards), character removed');
  await main.page.evaluate(() => { location.hash = '#/settings'; }); await sleep(500);
  await measure(main.page, 'main: settings (switches, sliders), character removed');
  await main.close();

  const pet = await h.open({ label: 'pet', seed: seedFor({ theme: 'ocean', mode: 'light', settings: { guessFirst: false } }) });
  await pet.page.waitForSelector('.bubble .vi', { timeout: 20_000 });
  await pet.page.waitForSelector('.rig[data-ready]', { timeout: 20_000 }).catch(() => console.log('  (rig not ready)'));
  await h.syncPet(pet.page);
  await measure(pet.page, 'pet: bubble + character');
  await pet.close();
  const pet2 = await h.open({ label: 'pet', seed: seedFor({ theme: 'ocean', mode: 'light', settings: { guessFirst: false, petCharacter: false, wordSec: 60 } }) });
  await pet2.page.waitForSelector('.bubble .vi', { timeout: 20_000 });
  await h.syncPet(pet2.page);
  await measure(pet2.page, 'pet: bubble only (character hidden), wordSec 60');
  await pet2.close();
} finally { await h.close(); }
