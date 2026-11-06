// Runtime gates, measured in headless Chrome on this machine with GPU on
// (the app's WebView2 is GPU-composited), device scale factor 2, window 300x600. Each run uses a fresh
// profile. Writes out/gates.json.
//   cpu      60 s of the real idle schedule per page (held frame, blinks, idle events, idle ticks). Two measures:
//            (a) CDP Performance.getMetrics TaskDuration delta (main-thread task time of the page),
//            (b) OS CPU time (user + kernel) of every Chrome process of the profile (renderer, GPU,
//                browser, utility), from Win32_Process, which also covers raster and compositing.
//            Gate on (b): rig <= sprite baseline + 2 % of one core.
//            Control: pages/exp-present.html (a bare WebGL canvas cleared to a new colour at 15 fps,
//            nothing else) shows what Chrome's per-frame compositing alone costs on this machine.
//   memory   rig page after 60 s: JS heap used after a forced GC + decoded atlas (1024*1024*4) + the
//            composited leg texture (512*H*4) + canvas
//            backing store (278*680*4) <= 9,452,000 B (motion/lib/limits.mjs BUDGET.ramCapBytes).
//   fps      20 s of back-to-back gestures (wave, happy, talk, drag): draws per second >= 30 (the loop
//            ticks at 30 while anything moves, not at all while held, 10 asleep) and the per-frame draw time.
//   hidden   15 s with the loop told the window is hidden: draws must not advance; CPU vs blank.
//            Also checks the visibilitychange path by hiding the page (a second tab brought to front).
//   sleep    20 s in the sleep loop: presented frames per second (ticks at 10 Hz, presents what moved); CPU.
// Usage: node gates.mjs [runs=3]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The old sprite (one held idle frame) is the CPU baseline the rig is gated against.
const APP = path.join(HERE, 'fixtures', 'sprite-baseline');
const RUNTIME = path.resolve(HERE, '../../../../src/lib/rig');   // the app's rig runtime, served at /lib/
const require = createRequire(path.join(HERE, 'motion', 'package.json'));
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RUNS = Number(process.argv[2] ?? 3);
const IDLE_MS = 60000;
const PRESENT_NOTE = 'present = a bare WebGL canvas changing colour at 15 fps (pages/exp-present.html): Chrome per-frame compositing alone';
const CAP = 9_452_000, ATLAS = 1024 * 1024 * 4, CANVAS = 278 * 680 * 4;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };

function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [base, rel] = u.startsWith('/app/') ? [APP, u.slice(5)] : u.startsWith('/lib/') ? [RUNTIME, u.slice(4)] : [HERE, u];
    const file = path.resolve(base, '.' + path.sep + rel);
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
/** CPU seconds (user + kernel) of every Chrome process whose command line names the profile. */
function chromeCpu(profile) {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { [string]($_.UserModeTime + $_.KernelModeTime) }`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return out.trim().split(/\r?\n/).filter(Boolean).reduce((a, x) => a + Number(x), 0) / 1e7;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const spread = (xs) => [Math.min(...xs), Math.max(...xs)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withPage(name, fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `rig-gate-${name}-`));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile,
    args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--force-device-scale-factor=2', '--window-size=300,600'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await page.createCDPSession();
    await cdp.send('Performance.enable');
    await page.goto(name === 'present' ? `${base}/pages/exp-present.html?mode=gl` : `${base}/pages/gate-${name}.html`);
    await page.waitForFunction('window.ready === true', { timeout: 120000 });
    await sleep(2000);
    const r = await fn({ page, cdp, profile, browser });
    return { ...r, errors };
  } finally { await browser.close(); fs.rmSync(profile, { recursive: true, force: true }); }
}
const task = async (cdp) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
async function window_(page, cdp, profile, ms) {
  const c0 = chromeCpu(profile), t0 = await task(cdp), d0 = await page.evaluate('window.draws()'), w0 = Date.now();
  await sleep(ms);
  const c1 = chromeCpu(profile), t1 = await task(cdp), d1 = await page.evaluate('window.draws()'), w1 = (Date.now() - w0) / 1000;
  return { seconds: +w1.toFixed(2), cpuCorePct: +(100 * (c1 - c0) / w1).toFixed(3), taskCorePct: +(100 * (t1 - t0) / w1).toFixed(3), drawsPerS: +((d1 - d0) / w1).toFixed(2) };
}

const srv = await serve();
const base = `http://127.0.0.1:${srv.address().port}`;
const runs = { blank: [], sprite: [], present: [], rig: [] };
const ONLY_RIG = process.env.ONLY_RIG === '1';
for (let run = 0; run < RUNS; run++) {
  for (const name of ONLY_RIG ? [] : ['blank', 'sprite', 'present']) {
    const r = await withPage(name, async ({ page, cdp, profile }) => ({ idle: await window_(page, cdp, profile, IDLE_MS) }));
    runs[name].push(r);
    console.log(`run ${run} ${name}: cpu ${r.idle.cpuCorePct}% task ${r.idle.taskCorePct}% draws/s ${r.idle.drawsPerS}`);
  }
  const r = await withPage('rig', async ({ page, cdp, profile, browser }) => {
    const out = {};
    out.idle = await window_(page, cdp, profile, IDLE_MS);
    out.idleDraw = await page.evaluate('window.drawStats()');
    await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage');
    const m = (await cdp.send('Performance.getMetrics')).metrics;
    const heap = m.find((x) => x.name === 'JSHeapUsedSize').value;
    const chainTex = await page.evaluate('window.compTexBytes()');
    out.memory = { jsHeapUsed: heap, atlas: ATLAS, legTexture: chainTex, canvas: CANVAS, total: heap + ATLAS + chainTex + CANVAS, cap: CAP };
    await page.evaluate('window.gestures()');
    await sleep(1000);
    await page.evaluate('window.drawStats()');
    await page.evaluate('window.activeFps()');
    out.gestures = await window_(page, cdp, profile, 20000);
    const af = await page.evaluate('window.activeFps()');
    out.gestures.clipFps = af.tick; out.gestures.clipPresentFps = af.present;
    out.gestureDraw = await page.evaluate('window.drawStats()');
    await page.evaluate('window.sleepNow()');
    await sleep(4500);                       // sleep enter (2.1 s) plus margin: into the loop
    out.sleep = await window_(page, cdp, profile, 20000);
    await page.evaluate('window.setHidden(true)');
    await sleep(1000);
    out.hidden = await window_(page, cdp, profile, 15000);
    await page.evaluate('window.setHidden(false)');
    await sleep(1000);
    // visibilitychange path: another tab in front hides this one
    const other = await browser.newPage(); await other.goto(`${base}/pages/gate-blank.html`); await other.bringToFront(); await sleep(1500);
    const vis = await page.evaluate('window.visibility()');
    const d0 = await page.evaluate('window.draws()'); await sleep(5000); const d1 = await page.evaluate('window.draws()');
    out.hiddenByVisibility = { visibilityState: vis, drawsIn5s: d1 - d0 };
    return out;
  });
  runs.rig.push(r);
  console.log(`run ${run} rig: idle cpu ${r.idle.cpuCorePct}% task ${r.idle.taskCorePct}% draws/s ${r.idle.drawsPerS} | gestures ${r.gestures.clipFps} fps in clips (${r.gestures.drawsPerS}/s with gaps) p95 ${r.gestureDraw.p95.toFixed(2)} ms | sleep ${r.sleep.drawsPerS}/s cpu ${r.sleep.cpuCorePct}% | hidden draws/s ${r.hidden.drawsPerS} cpu ${r.hidden.cpuCorePct}% | vis ${JSON.stringify(r.hiddenByVisibility)} | mem ${r.memory.total} B${r.errors.length ? ' ERR ' + r.errors[0] : ''}`);
}
srv.close();

const pick = (name, f) => runs[name].map(f);
const S = (xs) => ({ median: median(xs), spread: spread(xs), runs: xs });
if (ONLY_RIG) { console.log(JSON.stringify(runs.rig.map((r) => ({ idle: r.idle, sleep: r.sleep, gestures: r.gestures })))); process.exit(0); }
const summary = {
  method: 'Headless Chrome (GPU on, device scale factor 2), fresh profile per page and run, 2 s settle. CPU = OS user+kernel time of all Chrome processes of the profile over the window, % of one core; task = CDP TaskDuration (main thread only).',
  idleCpu: { blank: S(pick('blank', (r) => r.idle.cpuCorePct)), sprite: S(pick('sprite', (r) => r.idle.cpuCorePct)), present15fps: S(pick('present', (r) => r.idle.cpuCorePct)), rig: S(pick('rig', (r) => r.idle.cpuCorePct)) },
  idleRigFps: S(pick('rig', (r) => r.idle.drawsPerS)),
  idleTask: { blank: S(pick('blank', (r) => r.idle.taskCorePct)), sprite: S(pick('sprite', (r) => r.idle.taskCorePct)), rig: S(pick('rig', (r) => r.idle.taskCorePct)) },
  memoryTotal: S(pick('rig', (r) => r.memory.total)), jsHeap: S(pick('rig', (r) => r.memory.jsHeapUsed)),
  gestureFps: S(pick('rig', (r) => r.gestures.clipFps)), gesturePresentFps: S(pick('rig', (r) => r.gestures.clipPresentFps)), gestureDrawsPerSIncludingGaps: S(pick('rig', (r) => r.gestures.drawsPerS)), gestureDrawP95Ms: S(pick('rig', (r) => +r.gestureDraw.p95.toFixed(3))),
  sleepFps: S(pick('rig', (r) => r.sleep.drawsPerS)), sleepCpu: S(pick('rig', (r) => r.sleep.cpuCorePct)),
  hiddenFps: S(pick('rig', (r) => r.hidden.drawsPerS)), hiddenCpu: S(pick('rig', (r) => r.hidden.cpuCorePct)),
  visibility: pick('rig', (r) => r.hiddenByVisibility),
};
const g = summary;
// the rig's own share: its CPU minus a bare canvas changing at the same rate (present control scaled from 15 fps)
summary.rigOwnCpuEstimate = +(g.idleCpu.rig.median - g.idleCpu.present15fps.median * g.idleRigFps.median / 15).toFixed(3);
summary.gates = {
  cpu: { rule: 'rig idle CPU <= sprite idle CPU + 2 (% of one core): the median, and every single rig run', rig: g.idleCpu.rig.median, rigRuns: g.idleCpu.rig.runs, limit: +(g.idleCpu.sprite.median + 2).toFixed(3), pass: Math.max(...g.idleCpu.rig.runs) <= g.idleCpu.sprite.median + 2 },
  memory: { rule: `JS heap + atlas + canvas <= ${CAP} B`, value: g.memoryTotal.median, pass: g.memoryTotal.median <= CAP },
  fps: { rule: '>= 30 fps while a gesture clip plays: loop ticks during clips / time between them (each tick evaluates the pose; it is presented when a joint moved >= 0.5 device px or a drawing swapped; gesturePresentFps reports those); 29.5 allows timer jitter', value: g.gestureFps.median, pass: g.gestureFps.median >= 29.5 },
  hidden: { rule: 'no draws while hidden (setHidden and document hidden)', value: g.hiddenFps.median, pass: Math.max(...g.hiddenFps.runs) === 0 && g.visibility.every((v) => v.visibilityState !== 'hidden' || v.drawsIn5s === 0) },
  // the loop ticks at 10 Hz in the sleep loop and presents only what moved >= 0.5 device px, so the presented rate
  // sits below 10; the requirement is that she slows down asleep (for example 10 fps) and still breathes
  // a page error is a failed run whatever the numbers say: otherwise a TypeError in every gestures window goes unnoticed
  pageErrors: { rule: 'no page error on any gate page in any run', value: Object.values(runs).flat().flatMap((r) => r.errors ?? []).slice(0, 5), pass: Object.values(runs).flat().every((r) => !(r.errors ?? []).length) },
  sleep: { rule: 'slower while asleep: presented fps <= 11 (loop ticks at 10 Hz) and > 1 (the slow breath still shows)', value: g.sleepFps.median, pass: g.sleepFps.median <= 11 && g.sleepFps.median > 1 },
};
fs.writeFileSync(path.join(HERE, 'out', 'gates.json'), JSON.stringify({ summary, runs }, null, 1));
console.log(JSON.stringify(summary.gates, null, 1));
