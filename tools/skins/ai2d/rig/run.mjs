// The rig lever. One command rebuilds every artifact from the inputs and checks it:
//   1. motion/run.mjs      spec + checker + fixtures + numbered issue proof (see motion/MOTION_SPEC.md)
//   2. head_landmarks.py   iris, lens rims and jaw of every head drawing (out/head-landmarks.json)
//   2b. inbetween/run.py   the in-between arm drawings cut from the stored Codex edits (inbetween/src, no Codex call;
//                          hipfront and hipoff are cropped edits pasted back by inbetween/crop.py)
//   3. pack_atlas.py       out/atlas.webp, out/atlas.png, out/atlas-rects.json (art + key-pose + in-between parts),
//                          out/atlas-seed-glasses.webp (checker seed: rims drawn off the eyes)
//   4. build_rig.mjs       out/rig.json
//   5. render.mjs          out/frames/<clip>/{1x,4x}/NNNN.png + manifest.json (30 fps, every section)
//   6. render again        three clips must be byte-identical (determinism)
//   7. sheets.py           out/sheets: every frame at 1x and 2x, and 4x zoom columns (look at them)
//   8. verify_frames.py    planted shoes pixel-identical to rest, nothing within 2 px of a frame edge, 4x/1x agree
//   9. seeds               rigid-elbow render (--hard), cross-fade render (--xfade: doubled arm, ghosted head);
//                          seam_check.py --prove builds the other seeds (painted defects, a six-frame snap,
//                          drifted glasses on the ID pass): every rule must fail on its seed, clean frames pass
//  10. seam_check.py       every frame at 1x and 2x (pieces, edge, holes, dips, notch, cut, bulge, white, mesh, pop,
//                          swap, jump); cut and bulge compare each limb with the drawing it was posed from (seam_rules.py)
//  11. seam_check.py --glasses   glasses-to-eye offset on every frame (4x ID pass: rims vs irises)
//  12. gates.mjs 3         CPU vs the sprite baseline, memory cap, gesture fps, hidden stop, sleep slowdown
// Usage: node run.mjs [--no-gates]      Exit 0 only if every step holds.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PY = join(HERE, '..', '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
const results = [];
const run = (label, cmd, args, cwd = HERE) => {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const ok = r.status === 0;
  results.push({ label, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const tail = (r.stdout ?? '').trim().split('\n').slice(-2).join('\n');
  if (!ok) console.log((r.stdout ?? '') + (r.stderr ?? '')); else if (tail) console.log('     ' + tail.replace(/\n/g, '\n     '));
  return r;
};
const hashDir = (d) => {
  if (!existsSync(join(d, '1x'))) return null; const h = createHash('sha256'); for (const r of ['1x', '4x']) for (const f of readdirSync(join(d, r)).sort()) h.update(readFileSync(join(d, r, f))); return h.digest('hex'); };

mkdirSync(join(HERE, 'out'), { recursive: true });   // gitignored, so absent in a fresh clone
run('motion lever', process.execPath, ['run.mjs'], join(HERE, 'motion'));
run('head landmarks', PY, ['-I', 'head_landmarks.py']);
run('in-between arm drawings', PY, ['-I', 'run.py'], join(HERE, 'inbetween'));
run('pack atlas', PY, ['-I', 'pack_atlas.py']);
run('build rig.json', process.execPath, ['build_rig.mjs']);
rmSync(join(HERE, 'out', 'frames'), { recursive: true, force: true });
run('render all clips', process.execPath, ['render.mjs']);
{
  const again = join(HERE, 'out', 'frames-again');
  rmSync(again, { recursive: true, force: true });
  const clips = ['rest', 'wave', 'drag_loop', 'sleep_enter'];
  run('render three clips again', process.execPath, ['render.mjs', '--only', clips.join(','), '--out', again]);
  const same = clips.every((c) => existsSync(join(again, c)) && hashDir(join(HERE, 'out', 'frames', c)) === hashDir(join(again, c)));
  results.push({ label: 'renders are byte-identical', ok: same });
  console.log(`${same ? 'ok  ' : 'FAIL'} second render byte-identical (${clips.join(', ')})`);
  rmSync(again, { recursive: true, force: true });
}
run('contact sheets', PY, ['-I', 'sheets.py']);
const v = run('verify frames', PY, ['-I', 'verify_frames.py']);
if (v.status === 0) {
  const s = JSON.parse(readFileSync(join(HERE, 'out', 'verify.json'), 'utf8')).summary;
  const ok = s.feetPlantedIdentical && s.framesCutAtEdge === 0 && s.agreeMax <= 6 && s.endsAtRest;
  results.push({ label: 'frames verified', ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} planted shoes identical ${s.feetPlantedIdentical}, frames within 2 px of an edge ${s.framesCutAtEdge}, 4x/1x agree max ${s.agreeMax}, clip ends at rest ${s.endsAtRest} ${s.endsOffRest.join(', ')}`);
}
rmSync(join(HERE, 'out', 'seed-rigid'), { recursive: true, force: true });
run('render rigid-elbow seed (hard weights)', process.execPath, ['render.mjs', '--only', 'rest,wave', '--hard', '--out', join(HERE, 'out', 'seed-rigid')]);
rmSync(join(HERE, 'out', 'seed-xfade'), { recursive: true, force: true });
run('render cross-fade seed (arm and head cross-fades)', process.execPath, ['render.mjs', '--only', 'wave,happy,idle_glance', '--xfade', '--out', join(HERE, 'out', 'seed-xfade')]);
rmSync(join(HERE, 'out', 'seed-legacy'), { recursive: true, force: true });
run('render drawing-set seed without in-betweens (hairTuck)', process.execPath, ['render.mjs', '--only', 'hairTuck', '--legacy', '--out', join(HERE, 'out', 'seed-legacy')]);
rmSync(join(HERE, 'out', 'seed-glasses-colour'), { recursive: true, force: true });
run('render colour glasses-drift seed (rest, look)', process.execPath, ['render.mjs', '--only', 'rest,look', '--seed-glasses', '--out', join(HERE, 'out', 'seed-glasses-colour')]);
run('seam check proves on seeds', PY, ['-I', 'seam_check.py', '--prove']);
run('seam check, every frame at 1x and 2x', PY, ['-I', 'seam_check.py']);
run('glasses-to-eye offset, every frame', PY, ['-I', 'seam_check.py', '--glasses']);
if (!process.argv.includes('--no-gates')) {
  run('runtime gates (3 runs)', process.execPath, ['gates.mjs', '3']);
  const g = JSON.parse(readFileSync(join(HERE, 'out', 'gates.json'), 'utf8')).summary.gates;
  const ok = Object.values(g).every((x) => x.pass);
  results.push({ label: 'gates pass', ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} gates: ${Object.entries(g).map(([k, x]) => `${k} ${x.pass ? 'pass' : 'FAIL'}`).join(', ')}`);
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `RUN FAILED: ${failed.map((r) => r.label).join(', ')}` : 'RUN OK');
process.exit(failed.length ? 1 : 0);
