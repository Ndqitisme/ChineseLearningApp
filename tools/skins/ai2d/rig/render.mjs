// Deterministic offline renderer: every clip section at 30 fps, at 1x (139x340) and natively at 4x
// (556x1360), through rig-player.js in headless Chrome with software raster. Writes
//   out/frames/<clip>/{1x,4x}/NNNN.png  and  out/frames/manifest.json  (consistency/ input format)
//   out/frames/render-stats.json        (stretch clamps, head views, left-arm poses, timings)
//   out/frames/<clip>/id/NNNN.png      the 4x checker ID pass (R lens rims, G irises, B the first left-arm drawing)
//   out/frames/<clip>/id2/NNNN.png     only when a second left-arm drawing is drawn (seeded cross-fades)
// Usage: node render.mjs [--only key1,key2] [--out dir] [--hard | --xfade | --seed-glasses | --legacy]   (seeds: rigid elbow; whole-drawing cross-fades; rims drawn off the eyes; the older hairTuck drawing set)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { freshProfile, saveProfileAnswer } from '../../../chrome-profile.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, 'motion', 'package.json'));
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const OUT = path.resolve(opt('--out') ?? path.join(HERE, 'out', 'frames'));
const ONLY = opt('--only')?.split(',');
const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'motion', 'motion-spec.json'), 'utf8'));
const rig = JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'rig.json'), 'utf8'));
const artManifest = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'art', 'work', 'frames', 'manifest.json'), 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };

// /lib/ is the app's own rig runtime (src/lib/rig), so the frames are drawn by the code that ships.
const RUNTIME = path.resolve(HERE, '../../../../src/lib/rig');

export function serve(root) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [base, rel] = u.startsWith('/lib/') ? [RUNTIME, u.slice(4)] : [root, u];
    const file = path.resolve(base, '.' + rel);
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// clip list: rest, a stretch of standing idle, then every section
const clipDur = (c) => {
  let end = 0;
  const scan = (tr) => { end = Math.max(end, tr[tr.length - 1][0]); };
  Object.values(c.bones ?? {}).forEach(scan); Object.values(c.expressions ?? {}).forEach(scan); Object.values(c.fingers ?? {}).forEach(scan);
  if (c.gaze) scan(c.gaze); if (c.hipsOffset) scan(c.hipsOffset);
  return c.durationMs ?? end;
};
// Clips are rendered with the idle layer in a held gap of the idle schedule (idleT). With the idle layer at the
// clip's own local time, breathe would end inside a weight shift, off rest.
const IDLE_T = (() => {
  const sc = spec.idle.schedule, evs = sc.events.slice().sort((a, b) => a.at - b.at);
  const need = Math.max(...Object.values(spec.clips).flatMap((c) => (c.kind === 'stateful' ? [c.enter, c.loop, c.exit] : [c]).map((x) => clipDur(x)))) + 2000;
  for (let i = 0; i + 1 < evs.length; i++) if (evs[i + 1].at - (evs[i].at + evs[i].dur) >= need) return evs[i].at + evs[i].dur + 500;
  throw new Error('no held gap in the idle schedule long enough for the longest clip');
})();
// standing idle: the first event of each kind with 500 ms of held frame on both sides
const jobs = [{ dir: 'rest', key: 'rest', times: [0] }];
for (const kind of ['breath', 'weightShift', 'glance']) {
  const ev = spec.idle.schedule.events.find((e) => e.kind === kind), t0 = ev.at - 500, n = Math.ceil((ev.dur + 1000) * 30 / 1000);
  jobs.push({ dir: `idle_${kind}`, key: 'idle', times: [...Array(n + 1).keys()].map((i) => t0 + i * 1000 / 30) });
}
for (const [name, c] of Object.entries(spec.clips)) {
  const parts = c.kind === 'stateful' ? ['enter', 'loop', 'exit'] : ['oneShot'];
  for (const part of parts) {
    const sec = part === 'oneShot' ? c : c[part], d = clipDur(sec);
    const times = [];
    for (let i = 0; i * 1000 / 30 < d - 1; i++) times.push(i * 1000 / 30);
    times.push(d);
    // a section that ends at rest runs on (pose held at its end) until the hair, bow and skirt springs settle
    jobs.push({ dir: part === 'oneShot' ? name : `${name}_${part}`, key: `${name}.${part}`, times, settle: part === 'oneShot' || part === 'exit' });
  }
}
const todo = ONLY ? jobs.filter((j) => ONLY.includes(j.dir)) : jobs;

const srv = await serve(HERE);
const base = `http://127.0.0.1:${srv.address().port}`;
const profile = freshProfile('rig-render-');
// Software WebGL (SwiftShader) for byte-stable output, independent of the GPU driver.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile,
  args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb'] });
const S = 4;
const B = (j) => j.map((p) => [Math.round(p[0] * S * 10) / 10, Math.round(p[1] * S * 10) / 10]);
const manifest = { scale: S, rest_joints: {}, allowed_holes: {}, clips: {}, source: 'tools/skins/ai2d/rig/render.mjs (src/lib/rig)', note: 'Bones are the posed art joints the player computed (4x px). allowed_holes: the art rest gaps (hair/neck, hand-on-hip loop, right arm/skirt), carried by the part that bounds them.' };
const stats = { clips: {} };
const restHoles = artManifest.allowed_holes.rest['0'].map(([x, y]) => [x, y + rig.frame.artOffsetY * S]);
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/pages/render.html${args.includes('--hard') ? '?hard' : args.includes('--xfade') ? '?xfade' : args.includes('--seed-glasses') ? '?atlas=seed-glasses' : args.includes('--legacy') ? '?legacy' : ''}`);
  await page.waitForFunction('window.ready === true', { timeout: 120000 });
  const t0 = Date.now();
  let restJ = null;
  for (const job of todo) {
    for (const r of ['1x', '4x', 'id']) fs.mkdirSync(path.join(OUT, job.dir, r), { recursive: true });
    const cm = { peak: 0, head_views: [], joints: {}, change_zones: {}, head_turn: {}, head_centre: {} };
    const holes = {};
    const views = {}, pairs = {};
    let best = -1;
    job.n0 = job.times.length;
    await page.evaluate(() => window.begin());
    for (let i = 0; i < job.times.length; i++) {
      const r = await page.evaluate((k, t, it) => window.renderFrame(k, t, it), job.key, job.times[i], IDLE_T);
      if (job.settle && i === job.times.length - 1 && !r.settled && job.times.length - job.n0 < 60) job.times.push(job.times[i] + 1000 / 30);
      const name = String(i).padStart(4, '0');
      fs.writeFileSync(path.join(OUT, job.dir, '1x', `${name}.png`), Buffer.from(r.png1.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(OUT, job.dir, '4x', `${name}.png`), Buffer.from(r.png4.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(OUT, job.dir, 'id', `${name}.png`), Buffer.from(r.pngId.split(',')[1], 'base64'));
      if (r.pngId2) { fs.mkdirSync(path.join(OUT, job.dir, 'id2'), { recursive: true }); fs.writeFileSync(path.join(OUT, job.dir, 'id2', `${name}.png`), Buffer.from(r.pngId2.split(',')[1], 'base64')); }
      const bones = Object.fromEntries(Object.entries(r.joints).filter(([, v]) => v.length === 2).map(([b, v]) => [b, B(v)]));
      if (job.key === 'rest') { restJ = bones; manifest.rest_joints = bones; }
      cm.joints[i] = bones;
      cm.arm = cm.arm ?? {}; cm.arm[i] = r.arm;
      cm.mesh = cm.mesh ?? {}; cm.mesh[i] = r.mesh;   // skinned-mesh fold and shear (seam_check rule "mesh")   // left-arm drawing costs (evidence for the drawing choice)
      cm.head_turn[i] = r.headTurn; cm.head_centre[i] = r.headCentre.map((v) => Math.round(v * S * 10) / 10);
      views[r.headView] = (views[r.headView] ?? 0) + 1; pairs[r.pair] = (pairs[r.pair] ?? 0) + 1;
      if (r.headView !== 'head') cm.head_views.push(i);
      // the posed left hand is new content wherever it goes (the thumb sits outside the checker's capsule)
      const [a, b] = bones.leftHand ?? [];
      if (a && job.key !== 'rest') { const pad = 70; cm.change_zones[i] = [[Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad]]; }
      // rest gaps: hair/neck rides the head, the hip loop rides the left forearm (rest pose only), the arm gap rides the right forearm
      if (restJ) {
        const d = (bone) => [(bones[bone][0][0] + bones[bone][1][0] - restJ[bone][0][0] - restJ[bone][1][0]) / 2, (bones[bone][0][1] + bones[bone][1][1] - restJ[bone][0][1] - restJ[bone][1][1]) / 2];
        const hs = [];
        // the hair/neck gap rides the head (its centre's move from rest)
        const hc0 = manifest.clips.rest?.head_centre?.[0] ?? cm.head_centre[0], hc = cm.head_centre[i];
        hs.push([restHoles[0][0] + hc[0] - hc0[0], restHoles[0][1] + hc[1] - hc0[1]]);
        if (r.pair === 'rest') { const df = d('leftForearm'); hs.push([restHoles[1][0] + df[0], restHoles[1][1] + df[1]]); }
        const dr = d('rightForearm'); hs.push([restHoles[2][0] + dr[0], restHoles[2][1] + dr[1]]);
        holes[i] = hs.map((p) => p.map((v) => Math.round(v * 10) / 10));
      }
      // peak: the frame furthest from rest in the left arm with the front head view
      if (restJ && r.headView === 'head') {
        const dev = ['leftForearm', 'leftHand'].reduce((s, bn) => s + Math.hypot(bones[bn][1][0] - restJ[bn][1][0], bones[bn][1][1] - restJ[bn][1][1]), 0);
        if (dev > best) { best = dev; cm.peak = i; }
      }
    }
    manifest.clips[job.dir] = cm;
    manifest.allowed_holes[job.dir] = holes;
    stats.clips[job.dir] = { frames: job.times.length, key: job.key, settleFrames: job.settle ? job.times.length - job.n0 : 0, leftArmPoses: pairs };
    console.log(`${job.dir}: ${job.times.length} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (!ONLY || ONLY.includes('rest')) manifest.allowed_holes.rest = { 0: restHoles };
  stats.player = await page.evaluate(() => window.stats());
  stats.errors = errors;
  stats.seconds = (Date.now() - t0) / 1000;
} finally {
  await browser.close();
  srv.close();
  saveProfileAnswer(profile);
  fs.rmSync(profile, { recursive: true, force: true });
}
const mpath = path.join(OUT, 'manifest.json');
if (ONLY && fs.existsSync(mpath)) {
  const old = JSON.parse(fs.readFileSync(mpath, 'utf8'));
  for (const k of ['clips', 'allowed_holes']) Object.assign(old[k], manifest[k]);
  if (ONLY.includes('rest')) old.rest_joints = manifest.rest_joints;
  fs.writeFileSync(mpath, JSON.stringify(old));
} else fs.writeFileSync(mpath, JSON.stringify(manifest));
fs.writeFileSync(path.join(OUT, 'render-stats.json'), JSON.stringify(stats, null, 1));
console.log(stats.errors.length ? `ERRORS: ${stats.errors.slice(0, 3).join(' | ')}` : `rendered ${todo.length} clips in ${stats.seconds.toFixed(0)} s`);
