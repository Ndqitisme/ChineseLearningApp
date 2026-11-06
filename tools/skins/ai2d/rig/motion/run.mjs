// The motion lever: rebuilds the spec and proves it.
//   1. gen_spec.mjs      motion-spec.json, twice: must be byte-identical (deterministic)
//   2. check_spec        the good spec must pass (exit 0)
//   3. make_bad          fixtures/bad-spec.json must fail with every seeded rule, and each
//                        fixtures/single/<rule>.json must fail with its own rule
//   4. prove_issues.mjs  each numbered issue scenario fails on the motion-v1 scheduler and passes here;
//                        each checker fixture fails here (prove-issues.json)
// preview.mjs and fallback_sweep.mjs are not run here: the rig's real renders (../render.mjs) and
// gates (../gates.mjs) replace the stick previews and the RAM page.
// Usage: node run.mjs      Exit code 0 only if every step holds.
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const results = [];
const run = (label, cmd, args, expect = 0) => {
  const r = spawnSync(cmd, args, { cwd: HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = expect === 'nonzero' ? r.status !== 0 && r.status !== null : r.status === expect;
  results.push({ label, ok, status: r.status });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (exit ${r.status})`);
  if (!ok) console.log((r.stdout ?? '') + (r.stderr ?? ''));
  return r;
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const tmp = join(tmpdir(), `motion-spec-${process.pid}.json`);
run('generate spec', process.execPath, ['gen_spec.mjs']);
run('generate spec again', process.execPath, ['gen_spec.mjs', tmp]);
const same = sha(join(HERE, 'motion-spec.json')) === sha(tmp);
rmSync(tmp, { force: true });
results.push({ label: 'deterministic', ok: same });
console.log(`${same ? 'ok  ' : 'FAIL'} generator is deterministic`);
const good = run('good spec passes', process.execPath, ['check_spec.mjs', 'motion-spec.json', '--json', 'check-good.json']);
console.log(good.stdout.trim().split('\n').slice(-1).join('\n'));
run('build bad fixtures', process.execPath, ['make_bad.mjs']);
run('bad fixture fails', process.execPath, ['check_spec.mjs', 'fixtures/bad-spec.json', '--json', 'fixtures/check-bad.json'], 'nonzero');
const bad = JSON.parse(readFileSync(join(HERE, 'fixtures', 'check-bad.json'), 'utf8'));
const seeded = Object.keys(JSON.parse(readFileSync(join(HERE, 'fixtures', 'bad-spec.json'), 'utf8')).$fixture.seeded);
const missed = seeded.filter((r) => !bad.rules.includes(r));
results.push({ label: 'every seeded rule reported', ok: !missed.length });
console.log(`${missed.length ? 'FAIL' : 'ok  '} seeded rules reported: ${seeded.length - missed.length}/${seeded.length}${missed.length ? ' missed ' + missed.join(', ') : ''}; ${bad.violations.length} violations`);

const singles = readdirSync(join(HERE, 'fixtures', 'single')).filter((f) => f.endsWith('.json'));
const one = (f) => new Promise((ok) => {
  const want = Object.keys(JSON.parse(readFileSync(join(HERE, 'fixtures', 'single', f), 'utf8')).$fixture.seeded)[0];
  const p = spawn(process.execPath, ['check_spec.mjs', join('fixtures', 'single', f)], { cwd: HERE });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('close', (code) => ok({ f, want, code, fired: out.split('\n').some((l) => l.startsWith(`[${want}]`)) }));
});
const singleRes = [];
for (let i = 0; i < singles.length; i += 2) singleRes.push(...(await Promise.all(singles.slice(i, i + 2).map(one))));
const singleBad = singleRes.filter((r) => !(r.fired && r.code !== 0));
results.push({ label: 'every single-defect fixture fails with its rule', ok: !singleBad.length });
console.log(`${singleBad.length ? 'FAIL' : 'ok  '} single-defect fixtures: ${singleRes.length - singleBad.length}/${singleRes.length} fire their rule and exit non-zero${singleBad.length ? ' missed ' + singleBad.map((r) => r.f).join(', ') : ''}`);
run('numbered issues: the motion-v1 scheduler fails, this one passes', process.execPath, ['prove_issues.mjs']);

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `RUN FAILED: ${failed.map((r) => r.label).join(', ')}` : 'RUN OK');
process.exit(failed.length ? 1 : 0);
