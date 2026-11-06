// Before/after proof for the 11 numbered motion issues. Writes prove-issues.json and prints a table.
// motion-v1 is the earlier scheduler, spec and checker ("r1" in the code and the output).
//  Behaviour issues (1-7, 9 menu, 10): each scenario in lib/limits.mjs with an issue number runs on
//    A  the motion-v1 scheduler with the motion-v1 spec
//    B  the motion-v1 scheduler with this spec   (the spec alone does not fix it)
//    C  this scheduler with this spec            (must pass)
//  Checker issues (6 lip-sync, 8 twist, 9 stale refs / unimplemented keys, 11 stiffness) and the leg
//  defects (knee-in, floating foot, foot slide): each seeded fixture runs on the motion-v1 checker and on
//  this checker. A defect counts as invisible to motion-v1 when it reports no violation that the good spec
//  does not also get. This checker must fail the fixture with its rule.
// Usage: node prove_issues.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import * as NEW from '../../../../../src/lib/rig/behaviour.js';
import { BEHAVIOUR } from './lib/limits.mjs';
import { sampleTrack } from '../../../../../src/lib/rig/fk.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const R1 = resolve(HERE, '../../motion-v1');
const OLD = await import('file:///' + join(R1, 'lib/behaviour.mjs').replace(/\\/g, '/'));
const specNew = JSON.parse(readFileSync(join(HERE, 'motion-spec.json'), 'utf8'));
const specOld = JSON.parse(readFileSync(join(R1, 'motion-spec.json'), 'utf8'));
const VIS = ['aa', 'ih', 'ou', 'ee', 'oh'];

// mouth moving with no speech: visemes from the talk body clip (motion-v1) or the gated mouth layer (this spec)
function silentMouth(spec, segs, events, gated) {
  const speech = gated ? segs.speech ?? [] : (() => { const out = []; let a = null; for (const [t, n] of events) { if (n === 'speakStart') a = t; if (n === 'speakEnd' && a !== null) { out.push([a, t]); a = null; } } return out; })();
  const end = Math.max(...segs.map((s) => s.end).filter(Number.isFinite), 0);
  for (let t = 0; t <= end; t += 1000 / 30) {
    if (speech.some(([a, b]) => t >= a && t <= b + 150)) continue;
    let w = gated ? Math.max(0, ...Object.entries(NEW.mouthAt(spec, segs, t)).filter(([k]) => VIS.includes(k)).map(([, x]) => x)) : 0;
    const seg = segs.find((s) => s.part !== 'overlay' && s.start <= t && s.end > t && s.clip === 'talk');
    if (seg) { const sec = spec.clips.talk[seg.part]; for (const [k, tr] of Object.entries(sec?.expressions ?? {})) if (VIS.includes(k)) w = Math.max(w, sampleTrack(tr, t - seg.start)); }
    if (w > 0.01) return `mouth viseme ${w.toFixed(2)} at ${Math.round(t)} ms with no speech`;
  }
  return null;
}
function runScenario(lib, spec, sc, gated) {
  let segs;
  try { segs = lib.simulate(spec, sc.events); } catch (e) { return { fails: [`scheduler threw: ${e.message}`], timeline: [] }; }
  const fails = NEW.expectations(segs, sc.expect);
  if (sc.mouth) { const m = silentMouth(spec, segs, sc.events, gated); if (m) fails.push(m); }
  return { fails, timeline: segs.map((s) => `${s.clip}${s.part === 'oneShot' ? '' : '.' + s.part} ${Math.round(s.start)}-${Number.isFinite(s.end) ? Math.round(s.end) : 'open'} ${s.how}`) };
}

const out = { behaviour: {}, checker: {} };
console.log('BEHAVIOUR (scenario: A r1 sched + r1 spec | B r1 sched + new spec | C new sched + new spec)');
for (const [name, sc] of Object.entries(BEHAVIOUR.scenarios)) {
  if (!sc.issue) continue;
  const A = runScenario(OLD, specOld, sc, false), B = runScenario(OLD, specNew, sc, false), C = runScenario(NEW, specNew, sc, true);
  out.behaviour[name] = { issue: sc.issue, A, B, C };
  const f = (r) => (r.fails.length ? 'FAIL' : 'pass');
  console.log(`  issue ${String(sc.issue).padEnd(2)} ${name.padEnd(24)} A ${f(A)}  B ${f(B)}  C ${f(C)}   ${A.fails[0] ?? ''}`);
}

const check = (cwd, spec) => {
  const tmp = join(HERE, 'fixtures', `.tmp-${process.pid}.json`);
  const r = spawnSync(process.execPath, ['check_spec.mjs', spec, '--json', tmp], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  const j = JSON.parse(readFileSync(tmp, 'utf8'));
  return { code: r.status, keys: new Set(j.violations.map((x) => `${x.rule}|${x.where}`)), violations: j.violations };
};
const goodOld = check(R1, join(HERE, 'motion-spec.json'));
const FIX = [['lipSync', 6], ['twist', 8], ['sourceRefs', 9], ['implemented', 9], ['heldFrame', 11], ['idleGap', 11], ['idleBudget', 11], ['kneeIn', 'legs'], ['footFloat', 'legs'], ['footFloatClip', 'legs'], ['footSlide', 'legs'], ['behaviour', 7]];
console.log('CHECKER (fixture: r1 checker new violations vs the good spec | this checker)');
for (const [file, issue] of FIX) {
  const path = join(HERE, 'fixtures', 'single', `${file}.json`);
  const want = Object.keys(JSON.parse(readFileSync(path, 'utf8')).$fixture.seeded)[0];
  const o = check(R1, path), n = check(HERE, path);
  const newInOld = o.violations.filter((x) => !goodOld.keys.has(`${x.rule}|${x.where}`));
  const fired = n.violations.filter((x) => x.rule === want);
  out.checker[file] = { issue, rule: want, r1NewViolations: newInOld.slice(0, 5), r1Blind: newInOld.length === 0, thisChecker: { exit: n.code, fired: fired.length, first: fired[0] } };
  console.log(`  ${String(issue).padEnd(5)} ${file.padEnd(14)} r1: ${newInOld.length ? `${newInOld.length} new (${newInOld[0].rule})` : 'blind'}   this: ${fired.length ? `fails [${want}]` : 'MISSED'}`);
}
writeFileSync(join(HERE, 'prove-issues.json'), JSON.stringify(out, null, 1));
spawnSync('cmd', ['/c', 'del', join(HERE, 'fixtures', `.tmp-${process.pid}.json`)]);
const bad = Object.values(out.behaviour).filter((x) => x.C.fails.length || !(x.A.fails.length || x.B.fails.length)).length + Object.values(out.checker).filter((x) => !x.thisChecker.fired).length;
console.log(bad ? `PROOF FAILED (${bad})` : 'PROOF OK');
process.exit(bad ? 1 : 0);
