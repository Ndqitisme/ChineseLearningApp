// Builds out/rig.json: what the runtime (rig-player.js) needs to draw the parts from motion-spec.json.
//
// Data shape (frame coordinates in app px at 1x, y down, 139x340 frame; part pixels at 2x):
//   frame     { w, h, artOffsetY }        art placed artOffsetY px lower than the art units' framing, so a
//                                          lifted drag never cuts the crown
//   atlas     { file, size, rects }        rects[name] = [x, y, w, h] in atlas px (2x part pixels)
//   parts     { name: { rect, pos, z, group, bones? } }  pos = top-left in the frame at rest; bones = the
//              drawing's own joints in frame px (whole-arm drawings: S, E, W, T)
//   joints    { name: [x, y] }             the rest skeleton (hips, waist, neck, head, shoulders, elbows, wrists,
//                                          hand tips, hips, knees, ankles, toes)
//   chains    { name: { part | parts, bones: [[A, B] x3], z } }  one continuous skinned texture per limb drawing:
//              each left-arm key pose, the right arm, and each leg (thigh, shin and shoe composited once)
//   leftArm   { keys: { k: { chain, anchor, art, spec } }, clipKeys: { clip: [k...] }, ... }  the spec arm is
//              matched to each key's anchor pose; the two nearest keys are cross-faded on the mesh
//   head      { front: [...layers], views: [{ part, yaw, pitch, eyes }], warp }  head views and the yaw/pitch warp
//   secondary { part: { ... } }           springs for hair, bow and skirt
//   kArt      art px per spec px (hip to ankle at rest): scales root motion (dips, lifts, sway)
// Usage: node build_rig.mjs        (after pack_atlas.py and head_landmarks.py)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { composite, sectionsOf } from '../../../../src/lib/rig/compose.js';
import { layerState } from '../../../../src/lib/rig/layer2d.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = join(HERE, '..', 'art', 'out'), KEY = join(HERE, '..', 'art', 'keyposes', 'out');
const artParts = JSON.parse(readFileSync(join(ART, 'parts.json'), 'utf8')).parts;
const keyParts = JSON.parse(readFileSync(join(KEY, 'parts.json'), 'utf8')).parts;
// the in-between arm drawings (inbetween/run.py), same format as the key-pose parts
const inbParts = JSON.parse(readFileSync(join(HERE, 'inbetween', 'out', 'parts.json'), 'utf8')).parts;
Object.assign(keyParts, inbParts);
const atlas = JSON.parse(readFileSync(join(HERE, 'out', 'atlas-rects.json'), 'utf8'));
const eyes = JSON.parse(readFileSync(join(HERE, 'out', 'head-landmarks.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(HERE, 'motion', 'motion-spec.json'), 'utf8'));
const yaw = spec.camera.yawDeg, F = spec.frame;
const r2 = (v) => Math.round(v * 100) / 100;
const OFFSET_Y = 9;
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

const src = (name) => artParts[name] ?? keyParts[name];
const at1x = (p, q) => [r2(p.restPos1x[0] + q[0] / 2), r2(p.restPos1x[1] + q[1] / 2 + OFFSET_Y)];
const GROUP = (name) => {
  if (/^(head|frontHair|backHair|face)/.test(name)) return 'head';
  if (/^torso/.test(name)) return 'torso';
  return name.split('.')[0];
};
const parts = {};
for (const name of Object.keys(atlas.rects)) {
  const p = src(name);
  const o = { rect: atlas.rects[name], pos: at1x(p, [0, 0]), z: p.z, group: GROUP(name) };
  if (p.bones && p.chain) o.bones = Object.fromEntries(p.chain.map((k) => [k, at1x(p, p.bones[k])]));
  parts[name] = o;
}
// The hand tucking the strand is in front of it. At 16.5 the hair-tuck hands lie under the front hair (17), and
// the face-framing strand's hard-cut end shows as a dark wedge over the hand beside the lens.
for (const n of ['leftArm.tuck', 'leftArm.tuckmid']) parts[n].z = 17.5;
const P = artParts;
const pivot1x = (n) => at1x(P[n], P[n].pivot), tip1x = (n) => at1x(P[n], P[n].tip);
const LA = parts['leftArm.rest'].bones, RA = parts['rightArm.rest'].bones;
const joints = {
  hips: pivot1x('pelvis'), waist: keyParts['torso.noLeftSleeve'].pivot ? at1x(keyParts['torso.noLeftSleeve'], keyParts['torso.noLeftSleeve'].pivot) : pivot1x('torso'),
  neck: pivot1x('neck'), head: pivot1x('head'),
  leftShoulder: LA.S, leftElbow: LA.E, leftWrist: LA.W, leftHandTip: LA.T,
  rightShoulder: RA.S, rightElbow: RA.E, rightWrist: RA.W, rightHandTip: RA.T,
  leftHip: pivot1x('leftThigh'), leftKnee: tip1x('leftThigh'), leftAnkle: tip1x('leftShin'), leftToe: tip1x('leftShoe'),
  rightHip: pivot1x('rightThigh'), rightKnee: tip1x('rightThigh'), rightAnkle: tip1x('rightShin'), rightToe: tip1x('rightShoe'),
};
const B3 = (b) => [[b.S, b.E], [b.E, b.W], [b.W, b.T]];

// ---- spec states
const sections = sectionsOf(spec);
const secOf = (n, p) => sections.find((s) => s.name === n && s.part === p);
const stateAt = (n, p, t) => layerState(n === 'rest' ? composite(spec, { name: 'rest', part: 'loop', clip: {}, parent: {} }, 0, 0, false) : composite(spec, secOf(n, p), t, 0, false), yaw);
const L0 = stateAt('rest');
const specArm = (L) => Object.fromEntries(['leftUpperArm', 'leftForearm', 'leftHand'].map((n) => [n, { angle: r2(-L.limbs[n].angle), ratio: +L.limbs[n].ratio.toFixed(4) }]));

// ---- left arm key poses: whole-arm drawings from art/keyposes, each anchored at the spec time it stands for
const KEYS = {
  // rest gives way at costScale 2 (6 holds it too long; 1.2 leaves a clawed hand in the air early in the wave). The
  // hanging drawing may bend at most 28 deg: bent 45 deg toward the hip it reads as a banana forearm with a clawed hand
  rest: { part: 'leftArm.rest', anchor: ['rest'], costScale: 2 },
  // the waving drawing is turned 6 deg out about the shoulder, so its palm does not lie over the hair.
  // The wrist stays near the drawing (12 deg): on the way up the spec wrist droops, and the open hand turned
  // 90 deg down read as a broken wrist
  raise: { part: 'leftArm.wave_up', anchor: ['wave', 'oneShot', 560], upperOffsetDeg: 6, maxBendDeg: [45, 12], costScale: 0.55 },
  think: { part: 'leftArm.think', anchor: ['think', 'loop', 0], costScale: 2, maxBendDeg: [30, 30] },
  // the tuck and tuckmid drawings have the forearm painted over the sleeve: bent far, the texels there tear
  // (sheared sleeve); with tuckmid between front and tuck neither needs a large bend
  tuck: { part: 'leftArm.tuck', anchor: ['hairTuck', 'oneShot', 1300], maxBendDeg: [18, 25] },
  tuckmid: { part: 'leftArm.tuckmid', anchor: ['hairTuck', 'oneShot', 740], maxBendDeg: [18, 25], upperCost: 0.5 },
  front: { part: 'leftArm.front', anchor: ['think', 'enter', 470], maxBendDeg: [25, 30], upperCost: 0.7, costScale: 1.5 },
  // the hand just off the hip, two drawings on a crop (inbetween/crop.py).
  // hipfront: elbow at the side, forearm across the waist (hip <-> front: hairTuck, think and happy rise and
  // come back down through it); hipoff: the arm let go, hanging a little out (hip <-> hang: wave, talk, drag, sleep)
  hipfront: { part: 'leftArm.hipfront', anchor: ['think', 'enter', 330], maxBendDeg: [25, 30] },
  hipoff: { part: 'leftArm.hipoff', anchor: ['wave', 'oneShot', 240], maxBendDeg: [25, 30] },
  talk: { part: 'leftArm.talk', anchor: ['talk', 'loop', 0], upperOffsetDeg: 6 },
  happy: { part: 'leftArm.happy', anchor: ['happy', 'oneShot', 1100], maxBendDeg: [12, 20] },
  hang: { part: 'leftArm.drag', anchor: ['drag', 'loop', 0], maxBendDeg: [28, 30] },
  sleep: { part: 'leftArm.drag', anchor: ['sleep', 'loop', 0] },
  // land is the landing drawing only: chosen by spec distance it would also win early in drag_enter and late in
  // drag_exit, where its hand reaches the frame's right edge
  land: { part: 'leftArm.land', anchor: ['drag', 'exit', 200], costScale: 1.4 },
};
for (const k of Object.values(KEYS)) {
  const b = parts[k.part].bones;
  k.chain = k.part;
  k.art = { upper: { angle: r2(ang(b.S, b.E)), len: r2(dist(b.S, b.E)) }, forearm: { angle: r2(ang(b.E, b.W)), len: r2(dist(b.E, b.W)) }, hand: { angle: r2(ang(b.W, b.T)), len: r2(dist(b.W, b.T)) } };
  k.spec = specArm(k.anchor[0] === 'rest' ? L0 : stateAt(...k.anchor));
}
const clipKeys = {
  idle: ['rest'], blink: ['rest'], breathe: ['rest'], look: ['rest'], notice: ['rest'], nod: ['rest'],
  // the spec drops the hand off the hip and lets the arm hang a moment before a gesture rises and after it
  // comes down (gen_spec.mjs DROP): the hanging drawing carries that stretch, and the talk drawing (forearm out
  // level) the stretch where the forearm turns from down to up
  // think, hair tuck and happy rise straight from the hip in front of the body
  // through the in-between drawings, with no hang and no palm-up offer on the way
  hairTuck: ['rest', 'hipfront', 'front', 'tuckmid', 'tuck'], think: ['rest', 'hipfront', 'front', 'think'], talk: ['rest', 'hipoff', 'hang', 'talk'], happy: ['rest', 'hipfront', 'front', 'happy'],
  // one waving drawing: the swings are the skinned forearm turning about the elbow (two swing drawings swapped
  // on every swing, which cross-fading turns into a doubled hand)
  // no talk drawing in the wave: its palm-up hand, bent and end-on, reads as a lumpy elbow
  wave: ['rest', 'hipoff', 'hang', 'raise'], drag: ['rest', 'hipoff', 'hang', 'land'], 'drag.enter': ['rest', 'hipoff', 'hang'], sleep: ['rest', 'hipoff', 'sleep'],
};

// ---- chains: each whole-arm drawing, and each leg composited from thigh, shin and shoe
const chains = {};
for (const name of Object.keys(parts)) if (/^(left|right)Arm\./.test(name)) chains[name] = { part: name, bones: B3(parts[name].bones), z: parts[name].z };
for (const s of ['left', 'right']) {
  const J = joints;
  chains[`${s}Leg`] = { parts: [`${s}Shin`, `${s}Thigh`, `${s}Shoe`], bones: [[J[`${s}Hip`], J[`${s}Knee`]], [J[`${s}Knee`], J[`${s}Ankle`]], [J[`${s}Ankle`], J[`${s}Toe`]]], z: P[`${s}Thigh`].z };
}

// ---- head: the front head is layered (back hair, head, front hair, face swaps); the views are whole heads.
// eyes = iris centres in frame px (head_landmarks.py, mediapipe on each drawing), used to fit the yaw warp
const head = {
  front: { layers: ['backHair', 'head', 'frontHair'], closed: 'head.closed', eyes: eyes.head?.eyes ?? null },
  // one head drawing, warped by the turn. The key-pose head views are not used: cross-fading whole heads
  // shows two faces, and their necks and ponytails do not join the body.
  views: [],
  // the 2D warp is compressed to +/- these degrees (m tanh(turn / m)): past them it slides the features off the face
  maxTurnDeg: [16, 14],
};
// Warp: p -> p + (R sin yaw, Rv sin pitch) g(p): a Gaussian bump about the eye midpoint, cut off below the chin.
// R is the head's radius at eye level (half the face width, mediapipe face oval at the eye row): a sphere of
// radius R turned by d moves its front by R sin d. R is not fitted to the key-pose views (30 px):
// they turn the features about twice as far as their own outline does.
{
  const fe = head.front.eyes, mid = [(fe[0][0] + fe[1][0]) / 2, (fe[0][1] + fe[1][1]) / 2], jaw = eyes.head.jaw;
  const xs = jaw.filter((q) => Math.abs(q[1] - mid[1]) < 3).map((q) => q[0]);
  const R = (Math.max(...xs) - Math.min(...xs)) / 2, chin = Math.max(...jaw.map((q) => q[1]));
  head.warp = { sx: 14, sy: 18, cx: r2(mid[0]), cy: r2(mid[1]), R: r2(R), Rv: r2(R), chinY: r2(chin + 1), chinW: 10,
    note: 'p -> p + (R sin yaw, Rv sin pitch) g(p) k(y): g a Gaussian bump about the eye midpoint (cx, cy) of widths (sx, sy), k = clamp((chinY - y) / chinW, 0, 1) so the jaw stays on the neck; R = Rv = half the face width at the eye row. Glasses, eyes, nose and mouth share the warp, so the glasses stay on the eyes.' };
}

// ---- secondary motion: springs on the part's anchor, shown as a shear growing with distance from the anchor
const secondary = {
  frontHair: { anchorY: r2(parts.frontHair.pos[1] + 10), depth: 30, k: 120, damp: 9, gain: 0.9, maxPx: 1.5 },
  backHair: { anchorY: r2(parts.backHair.pos[1]), depth: 16, k: 90, damp: 7, gain: 1.0, maxPx: 1.5 },
  pelvis: { anchorY: r2(joints.hips[1] + 6), depth: 40, k: 140, damp: 10, gain: 0.7, maxPx: 1.2 },
  bow: { part: 'torso.noLeftSleeve', box: [r2(joints.neck[0] - 9), r2(joints.neck[1] + 6), r2(joints.neck[0] + 9), r2(joints.neck[1] + 40)], anchorY: r2(joints.neck[1] + 8), depth: 30, k: 160, damp: 10, gain: 0.8, maxPx: 1.2 },
};

// ---- root scale: art px per spec px, hip to ankle at rest
const specPx = (x, y) => [F.originXPx + x * F.pxPerM, F.originYPx - y * F.pxPerM];
const sHip = specPx(L0.limbs.rightThigh.x, L0.limbs.rightThigh.y), sAnk = specPx(L0.limbs.rightShoe.x, L0.limbs.rightShoe.y);
const kArt = r2(dist(joints.rightHip, joints.rightAnkle) / dist(sHip, sAnk));

const rig = {
  about: 'Tieu Mai layered 2D rig. Built by tools/skins/ai2d/rig/build_rig.mjs from the art and key-pose parts and motion-spec.json; drawn by src/lib/rig.',
  licence: 'Art CC0-1.0 (generated for this project); code MIT',
  frame: { w: 139, h: 340, artOffsetY: OFFSET_Y },
  atlas: { file: 'atlas.webp', size: atlas.size, partsPx: atlas.partsPx, fill: atlas.fill },
  parts, joints, chains,
  leftArm: { keys: KEYS, clipKeys, choose: 'spec', weightPower: 3, fadeMs: 70, hysteresisDeg: 8, maxBendDeg: [45, 40],
    note: 'Shepard weights 1/d^weightPower by distance d to each key anchor (angles; exactly 1 at an anchor); angle and length offsets art - spec are blended by weight. The drawing shown is the one the pose bends least (upper-arm turn + elbow and wrist bend change from its own configuration, 8 deg hysteresis), and no drawing bends more than maxBendDeg at the elbow and wrist (skinning folds beyond that); when the drawing changes it swaps at once on the same posed bones (a cross-fade shows two arms). fadeMs is used only by the seeded cross-fade render (render.mjs --xfade) that the doubled-limb rule must catch. costScale > 1 makes a drawing give way sooner (the hip drawing leaves as the hand leaves the hip).' },
  head,
  face: { eyesClosed: { expr: 'blink', min: 0.5 }, smile: { expr: 'happy', min: 0.35, part: 'face.mouth.smile' }, talk: { exprs: ['aa', 'ih', 'ou', 'ee', 'oh'], min: 0.2, part: 'face.mouth.talk' } },
  secondary,
  stretch: { min: 0.75, max: 1.25, minLeftArm: [0.7, 0.5, 0.7], note: 'a drawing is stretched along its bone by at most 25 %; beyond that it is clamped and counted. The left arm may shorten further (upper arm, forearm, hand) where the spec projects it end-on: every raise passes the forearm through pointing at the camera (projected ratio 0.10-0.30); below half length a drawing reads as collapsed, so the cross-fade to the next key covers that stretch.' },
  kArt,
};
writeFileSync(join(HERE, 'out', 'rig.json'), JSON.stringify(rig, null, 1));
console.log('wrote out/rig.json', 'kArt', kArt, 'parts', Object.keys(parts).length, 'chains', Object.keys(chains).length, 'warp', JSON.stringify(head.warp));
for (const [k, pr] of Object.entries(KEYS)) console.log(k.padEnd(6), pr.anchor.join(' ').padEnd(18), 'art', [pr.art.upper.angle, pr.art.forearm.angle, pr.art.hand.angle].join(' '), 'spec', ['leftUpperArm', 'leftForearm', 'leftHand'].map((n) => pr.spec[n].angle).join(' '));
