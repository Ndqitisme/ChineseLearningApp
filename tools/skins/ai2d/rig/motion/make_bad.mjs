// Builds the bad fixtures from the good spec:
//   fixtures/bad-spec.json        every compatible seeded defect at once
//   fixtures/single/<rule>.json   one defect each, so every rule is shown to fire on its own
// SEEDS lists the rule each defect must trigger; run.mjs fails if the checker misses any.
// Usage: node make_bad.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { euler } from '../../../../../src/lib/rig/fk.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const good = readFileSync(join(HERE, 'motion-spec.json'), 'utf8');
const Z = [0, 0, 0];
// Euler XYZ (matrix = Rx*Ry*Rz) back from a row-major matrix, and a pure twist of a limb about its own axis.
const toEuler = (M) => { const D = 180 / Math.PI, y = Math.asin(Math.max(-1, Math.min(1, M[2]))); return [Math.atan2(-M[5], M[8]) * D, y * D, Math.atan2(-M[1], M[0]) * D].map((v) => Math.round(v * 10) / 10); };
const mul3 = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
const twisted = (angles, deg) => toEuler(mul3(euler(angles), euler([deg, 0, 0])));   // arm bones lie along local X
const dropLegs = (layer) => { for (const k of Object.keys(layer.channels)) if (/(Upper|Lower)Leg|Foot/.test(k)) delete layer.channels[k]; };

export const SEEDS = [
  { rule: 'structure', note: 'wave head keys out of order', apply: (s) => { const h = s.clips.wave.bones.head; [h[1][0], h[2][0]] = [h[2][0], h[1][0]]; } },
  { rule: 'restEnds', note: 'look ends with the head still turned 10 deg', apply: (s) => { const h = s.clips.look.bones.head; h[h.length - 1][1] = [0, 10, 0]; } },
  { rule: 'jointRange', note: 'nod pitches the head 60 deg past its range', apply: (s) => { s.clips.nod.bones.head = [[0, Z], [120, [-2, 0, 0]], [300, [60, 0, 0]], [650, [2, 0, 0]], [900, Z]]; } },
  { rule: 'velocity', note: 'nod reaches that pitch in 180 ms', apply: (s) => { s.clips.nod.bones.head = [[0, Z], [120, [-2, 0, 0]], [300, [60, 0, 0]], [650, [2, 0, 0]], [900, Z]]; } },
  { rule: 'hinge', note: 'think.loop twists the forearm 30 deg about the humerus (lowerArm.x)', apply: (s) => { for (const k of s.clips.think.loop.bones.leftLowerArm) k[1] = [k[1][0] + 30, k[1][1], k[1][2]]; } },
  { rule: 'exprRange', note: 'happy smile weight 1.5', apply: (s) => { s.clips.happy.expressions.happy = [[0, 0], [400, 1.5], [1300, 0.85], [2200, 0]]; } },
  { rule: 'gazeRange', note: 'look gaze 40 deg sideways', apply: (s) => { s.clips.look.gaze[1][1] = [-40, 2]; } },
  { rule: 'fingerRange', note: 'wave fingers curl 1.6', apply: (s) => { s.clips.wave.fingers.left[2][1] = [1.6, 0.3, -0.25]; } },
  { rule: 'leftArmOnly', note: 'wave raises the right arm 40 deg', apply: (s) => { s.clips.wave.bones.rightUpperArm = [[0, Z], [800, [0, 0, -40]], [1800, [0, 0, -40]], [2650, Z]]; } },
  { rule: 'rightSilhouette', note: 'the same right arm swings out past the rest edge', apply: (s) => { s.clips.wave.bones.rightUpperArm = [[0, Z], [800, [0, 0, -40]], [1800, [0, 0, -40]], [2650, Z]]; } },
  { rule: 'edgeSilhouette', note: 'drag.loop kicks the right leg 35 deg out toward the screen edge', apply: (s) => { for (const k of s.clips.drag.loop.bones.rightUpperLeg) k[1] = [k[1][0], k[1][1], k[1][2] - 35]; } },
  { rule: 'penetration', note: 'breathe bends the left wrist so the fingers go into the pelvis', apply: (s) => { s.clips.breathe.bones.leftHand = [[0, Z], [1100, [0, 0, -55]], [2000, [0, 0, -55]], [3100, Z]]; } },
  { rule: 'footPlant', note: 'happy drops the hips 4.5 cm without bending the legs', apply: (s) => { const c = s.clips.happy; c.hipsOffset = c.hipsOffset.map(([t, v, f]) => (f ? [t, v.map((x) => x * 2.5), f] : [t, v.map((x) => x * 2.5)])); for (const b of ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']) delete c.bones[b]; } },
  { rule: 'balance', note: 'rest weight thrown onto one leg: pelvis dropped 6 deg and shifted 3 cm (the r1 contrapposto)', apply: (s) => { s.rest.bones.hips = [0, 0, -6]; s.rest.hipsOffset = [-0.03, s.rest.hipsOffset[1], 0]; } },
  { rule: 'kneeIn', note: 'rest left knee turned in: thigh rotated 25 deg inward with the knee bent 18 deg (the look-B model pose the user called odd)', apply: (s) => { s.rest.bones.leftUpperLeg = [-6, -25, 3]; s.rest.bones.leftLowerLeg = [18, 0, 0]; } },
  { rule: 'footFloat', note: 'rest left toes lifted: the foot pitched 15 deg up, the toe floats 3 cm', apply: (s) => { const f = s.rest.bones.leftFoot; s.rest.bones.leftFoot = [f[0] - 15, f[1], f[2]]; } },
  { rule: 'footFloat', solo: 'footFloatClip', note: 'happy lifts her left foot off the ground in its bounce (thigh forward 10 deg, knee 20 deg) while the right stays planted', apply: (s) => { const c = s.clips.happy.bones; c.leftUpperLeg = [[0, Z], [620, [-10, 0, 0]], [1150, Z], [2200, Z]]; c.leftLowerLeg = [[0, Z], [620, [20, 0, 0]], [1150, Z], [2200, Z]]; c.leftFoot = [[0, Z], [2200, Z]]; } },
  { rule: 'footPlant', solo: 'footSlide', note: 'the idle weight sway keeps the pelvis shift but loses its leg re-solve: both feet slide with the hips', apply: (s) => { for (const l of s.idle.layers) if (/^weightSway/.test(l.name)) { dropLegs(l); l.coupled = ['hips', 'hipsOffset']; for (const k of ['hipsOffset']) l.channels[k] = l.channels[k].map((x) => x * 2.5); } } },
  { rule: 'twist', note: 'rest right arm twisted 70 deg further inward about the humerus (85 deg in all): same joint positions, an impossible rotation (the r1 checker cannot see it)', apply: (s) => { s.rest.bones.rightUpperArm = twisted(s.rest.bones.rightUpperArm, 70); } },
  { rule: 'lipSync', note: 'the fallback visemes moved back into talk.loop and the mouth layer gate dropped (the r1 behaviour): the mouth moves after speech ends', apply: (s) => { s.clips.talk.loop.expressions = { ...s.clips.talk.loop.expressions, ...s.stateMachine.mouth.tracks }; s.stateMachine.mouth.gate = 'always'; } },
  { rule: 'sourceRefs', note: 'speakStart cites index.ts:244 and :225 (the r1 references; the file has 71 lines)', apply: (s) => { const e = s.stateMachine.events.speakStart; e.source = 'NEW: speech start signal at speechSynthesis.speak (index.ts:244) or audio.play() (index.ts:225)'; e.at = [{ file: 'src/lib/speech/index.ts', line: 244, text: 'speechSynthesis.speak(' }]; } },
  { rule: 'implemented', note: 'hoverEnter.greet put back: in the spec, in no scheduler (r1)', apply: (s) => { s.stateMachine.events.hoverEnter.greet = { clip: 'wave', ifNoHoverForMs: 300000, cooldownMs: 300000 }; } },
  { rule: 'heldFrame', note: 'an always-on idle: the breath layer loses its event and runs all the time, so the standing frame is never held', apply: (s) => { delete s.idle.layers.find((l) => l.name === 'breath').event; } },
  { rule: 'idleEvents', solo: 'idleGap', note: 'idle keeps only its first event: after it she stands frozen for the rest of the 120 s cycle (MOTION_SPEC.md issue 11, stiffness)', apply: (s) => { s.idle.schedule.events = s.idle.schedule.events.slice(0, 1); } },
  { rule: 'idleEvents', solo: 'idleBudget', note: 'idle events back to back with idle clips every 6-14 s: the presented rate breaks the CPU guide', apply: (s) => { const ev = s.idle.schedule.events; s.idle.schedule.events = ev.map((e, i) => ({ ...e, at: i ? ev[i - 1].at + ev[i - 1].dur : e.at })); s.stateMachine.events.idleTick.intervalMs = [6000, 14000]; } },
  { rule: 'contact', note: 'rest left hand flexed away so the fingertips leave the hip', apply: (s) => { const h = s.rest.bones.leftHand; s.rest.bones.leftHand = [h[0], h[1], h[2] + 30]; } },
  { rule: 'frozenHold', note: 'think.loop holds every track still with the idle layer muted', apply: (s) => {
    const L = s.clips.think.loop;
    for (const tr of [...Object.values(L.bones), ...Object.values(L.fingers ?? {}), ...Object.values(L.expressions ?? {}), L.gaze]) for (const k of tr) k[1] = JSON.parse(JSON.stringify(tr[0][1]));
    s.clips.think.idleWeight = Object.fromEntries(Object.keys(s.rest.bones).map((b) => [b, 0]));
  } },
  { rule: 'pop', note: 'hairTuck snaps the head 40 deg in 33 ms', apply: (s) => { s.clips.hairTuck.bones.head.splice(1, 0, [33, [0, 40, 0]]); } },
  { rule: 'easeFrames', note: 'notice jumps 20 deg in the first 33 ms', apply: (s) => { s.clips.notice.bones.head = [[0, Z], [33, [0, 20, 0]], [1100, [0, 20, 0]], [1600, Z]]; } },
  { rule: 'seam', note: 'talk.loop starts with the head 8 deg away from where talk.enter ended', apply: (s) => { const h = s.clips.talk.loop.bones.head; h[0][1] = h[0][1].map((x, i) => (i === 1 ? x + 8 : x)); } },
  { rule: 'layerSeam', note: 'idle weight ramp removed (the r1 behaviour): the pose steps when a clip starts', apply: (s) => { s.idle.rampMs = 0; } },
  { rule: 'frameFit', note: 'drag lifts the hips 30 cm, out of the top of the frame', apply: (s) => { for (const sec of ['enter', 'loop']) s.clips.drag[sec].hipsOffset = s.clips.drag[sec].hipsOffset.map(([t, v, f]) => (f ? [t, [v[0], v[1] * 7.5, v[2]], f] : [t, [v[0], v[1] * 7.5, v[2]]])); const ex = s.clips.drag.exit.hipsOffset; ex[0][1] = [ex[0][1][0], ex[0][1][1] * 7.5, ex[0][1][2]]; } },
  { rule: 'layerForeshorten', note: 'left forearm keeps only its full-length drawing (rotate-only layer)', apply: (s) => { s.twoD.parts.leftForearm.variants = [{ nominal: 1 }]; } },
  { rule: 'layerViews', note: 'head has one view only, so the look turn cannot show', apply: (s) => { s.twoD.parts.head.yawViews = [20]; } },
  { rule: 'rest', note: 'rest right elbow bent 38.6 deg like v4', apply: (s) => { s.rest.bones.rightLowerArm = [0, 38.6, 0]; } },
  { rule: 'coverage', note: 'breathe loses its agreed tag', apply: (s) => { delete s.clips.breathe.agreed; } },
  { rule: 'stateMachine', note: 'dragEnd removed and idleTick picks a clip that does not exist', apply: (s) => { delete s.stateMachine.events.dragEnd; s.stateMachine.events.idleTick.pick[0][0] = 'lookx'; } },
  { rule: 'stateMachine', solo: 'stateMachinePick', note: 'only renames look to lookx in idleTick.pick (r1 checker missed this)', apply: (s) => { s.stateMachine.events.idleTick.pick[0][0] = 'lookx'; } },
  { rule: 'queueExpiry', note: 'queue expiry 2000 ms, shorter than wake + wave', apply: (s) => { s.stateMachine.interrupt.queue.expiryMs = 2000; } },
  { rule: 'behaviour', note: 'click acknowledged by a queued body nod again (r1): during talk it comes seconds late or never', apply: (s) => { s.stateMachine.events.click = { source: s.stateMachine.events.click.source, at: s.stateMachine.events.click.at, clip: 'nod', priority: 45, cooldownMs: 600, locks: true }; } },
  { rule: 'budget', note: 'atlas declared 256x256: the parts cannot fit (and a spec-side cap of 1e9 B is ignored)', apply: (s) => { s.twoD.atlas = { w: 256, h: 256 }; s.budget.ramCapBytes = 1e9; } },
  { rule: 'budget', solo: 'budgetSprite', note: 'ships the 5 fps sprite: 22.7 MB decoded, 2.4x the v4 cap', apply: (s) => { s.budget.ships = 'sprite'; s.budget.runtimes.sprite.maxRamBytes = 1e9; } },
  { rule: 'pop', solo: 'popSprite', note: 'ships the 5 fps sprite: its frames pop', apply: (s) => { s.budget.ships = 'sprite'; } },
];

const dir = join(HERE, 'fixtures'), single = join(dir, 'single');
rmSync(single, { recursive: true, force: true });
mkdirSync(single, { recursive: true });
const all = JSON.parse(good);
const seeded = {};
for (const sd of SEEDS) {
  const one = JSON.parse(good);
  sd.apply(one);
  one.$fixture = { seeded: { [sd.rule]: sd.note } };
  writeFileSync(join(single, `${sd.solo ?? sd.rule}.json`), JSON.stringify(one));
  if (sd.solo) continue;
  sd.apply(all);
  seeded[sd.rule] = seeded[sd.rule] ? `${seeded[sd.rule]}; ${sd.note}` : sd.note;
}
all.$fixture = { seeded, note: 'Deliberately broken copy of motion-spec.json. check_spec.mjs must report every rule in seeded and exit non-zero. fixtures/single/ holds one defect per file.' };
writeFileSync(join(dir, 'bad-spec.json'), JSON.stringify(all, null, 1));
console.log(`wrote fixtures/bad-spec.json with ${Object.keys(seeded).length} seeded rules and ${SEEDS.length} single-defect fixtures`);
