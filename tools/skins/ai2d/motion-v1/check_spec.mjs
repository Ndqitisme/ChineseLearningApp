// Validates a motion spec. Prints every violation as "[rule] where: message" and exits 1 if any.
// Usage: node check_spec.mjs [spec.json] [--json out.json] [--ram artifacts/ram.json]
// Every limit comes from lib/limits.mjs, never from the spec, so a spec cannot widen its own
// ranges or raise its own budget. Rules for the shipped runtime fail the run; the degraded sprite
// fallback is measured at its own fps and reported in a separate block (it fails the run only if
// the spec ships it).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fk, project, actionAt, clipDuration, ROTATING, euler, BONES } from './lib/fk.mjs';
import { LIMITS, VEL, MOTION, BODY, BALANCE, FRAME, BUDGET, TWO_D, BEHAVIOUR } from './lib/limits.mjs';
import { composite, idleOnly, sectionsOf } from './lib/compose.mjs';
import { centreOfMass, supportOf, groundDist, lineDeg, pelvisE, pelvisDist, torsoE, handSites } from './lib/body.mjs';
import { layerState, pickVariant, LIMB_PARTS, drawnPoints } from './lib/layer2d.mjs';
import { simulate, expectations } from './lib/behaviour.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const jsonOut = opt('--json');
const ramPath = opt('--ram') ?? join(HERE, 'artifacts', 'ram.json');
const specPath = args.find((a, i) => !a.startsWith('--') && !['--json', '--ram'].includes(args[i - 1])) ?? join(HERE, 'motion-spec.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const AGREED = ['breathe', 'blink', 'look', 'hair tuck', 'think', 'talk', 'wave', 'happy', 'drag', 'sleep'];
const REQUIRED_EVENTS = ['wordShownRevealed', 'wordShownGuess', 'reveal', 'speakStart', 'speakEnd', 'known', 'hoverEnter', 'click', 'dragStart', 'dragEnd', 'longIdle', 'quietHours', 'userBack', 'fullscreenHide', 'fullscreenShow', 'appStart', 'idleTick'];
const RIGHT_ARM = ['rightUpperArm', 'rightLowerArm', 'rightHand'];
const RIGHT_ARM_SITES = ['rightLowerArm', 'rightHand', 'rightHandTip'];
const EPS = 0.05;
const D = (r) => r * 180 / Math.PI;
/** Geodesic angle (deg) between two Euler rotations: how far the bone really turned, whatever the channels did. */
function rotAngle(a, b) {
  const A = euler(a), B = euler(b);
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[k * 3 + i] * B[k * 3 + i];
  return D(Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))));
}

const violations = [], fallback = [];
const v = (rule, where, msg) => violations.push({ rule, where, msg });
const fb = (rule, where, msg) => fallback.push({ rule, where, msg });
const stats = {};

// ---------------------------------------------------------------- setup
const rest = spec.rest;
const yaw = spec.camera?.yawDeg ?? 0;
const sections = sectionsOf(spec);
for (const [name, clip] of Object.entries(spec.clips ?? {})) if (clip.kind === 'stateful') for (const part of ['enter', 'loop', 'exit']) if (!clip[part]) v('structure', name, `stateful clip has no ${part}`);
const where = (s, t) => `${s.name}${s.part === 'oneShot' ? '' : '.' + s.part}${t === undefined ? '' : ` @${Math.round(t)}ms`}`;
const C = (s, t, idleT = 0, withIdle = true) => composite(spec, s, t, idleT, withIdle);
const restP = { pose: Object.fromEntries(ROTATING.map((b) => [b, rest.bones?.[b] ?? [0, 0, 0]])), hipsOffset: rest.hipsOffset ?? [0, 0, 0] };
const restWorld = fk(restP.pose, restP.hipsOffset);
const restProj = Object.fromEntries(Object.entries(restWorld).map(([b, j]) => [b, project(j.p, yaw)]));
const silhouetteEdge = Math.min(...['rightUpperArm', ...RIGHT_ARM_SITES].map((b) => restProj[b][0]));
const STAND = BALANCE.standingFoot, FREE = STAND === 'rightFoot' ? 'leftFoot' : 'rightFoot';
const ground = restWorld[STAND].p[1];
const restSupport = supportOf(restWorld, STAND);
const maxAbs = (vec) => Math.max(...vec.map(Math.abs));
const isZero = (x) => (Array.isArray(x) ? maxAbs(x) : Math.abs(x)) <= EPS;
const fps = spec.budget?.runtimes?.[spec.budget?.ships]?.evalFps ?? 30;
const px = spec.frame?.pxPerM ?? 0;
stats.rest = { silhouetteEdgeX: +silhouetteEdge.toFixed(4), groundY: +ground.toFixed(4), leftWrist: restWorld.leftHand.p.map((x) => +x.toFixed(3)), rightWrist: restWorld.rightHand.p.map((x) => +x.toFixed(3)) };

// ---------------------------------------------------------------- rest pose
for (const [b, lim] of Object.entries(LIMITS)) {
  const r = rest.bones?.[b];
  if (!r) { v('rest', b, 'rest pose has no value for this bone'); continue; }
  ['x', 'y', 'z'].forEach((ax, k) => { if (r[k] < lim[ax][0] || r[k] > lim[ax][1]) v(/LowerArm/.test(b) && ax !== 'y' ? 'hinge' : 'jointRange', `rest.${b}.${ax}`, `${r[k]} outside ${lim[ax]}`); });
}
{
  const lf = -(rest.bones.leftLowerArm?.[1] ?? 0), rf = rest.bones.rightLowerArm?.[1] ?? 0;
  if (rf > 25) v('rest', 'rightLowerArm', `relaxed right elbow is bent ${rf} deg (> 25): reads as held, not hanging`);
  if (lf < 70 || lf > 130) v('rest', 'leftLowerArm', `hand-on-hip elbow flex ${lf} deg outside 70-130`);
  const ls = supportOf(restWorld, 'leftFoot'), rs = supportOf(restWorld, 'rightFoot');
  if (ls[0] - rs[0] < 0.08) v('rest', 'feet', `feet ${((ls[0] - rs[0]) * 100).toFixed(1)} cm apart (< 8): crossed or too close`);
  // balance at rest
  const com = centreOfMass(restWorld);
  const dRest = groundDist(com, restSupport);
  const pelvis = lineDeg(restWorld, 'leftUpperLeg', 'rightUpperLeg'), shoulders = lineDeg(restWorld, 'leftUpperArm', 'rightUpperArm');
  const counter = shoulders - 0; // pelvis drops on the free side, the shoulder line must rise on that side
  stats.balance = { com: com.map((x) => +x.toFixed(3)), standingSupport: restSupport.map((x) => +x.toFixed(3)), comToSupportCm: +(dRest * 100).toFixed(2), pelvisLineDeg: +pelvis.toFixed(2), shoulderLineDeg: +shoulders.toFixed(2) };
  if (dRest > BALANCE.comTolM) v('balance', 'rest', `centre of mass ${(dRest * 100).toFixed(1)} cm from the standing foot (> ${BALANCE.comTolM * 100})`);
  if (Math.sign(pelvis) === Math.sign(shoulders) || Math.abs(counter) < BALANCE.minShoulderCounterTiltDeg || Math.abs(counter) > BALANCE.maxShoulderCounterTiltDeg)
    v('balance', 'rest', `shoulder line ${shoulders.toFixed(2)} deg against pelvis ${pelvis.toFixed(2)} deg: counter-tilt must be opposite and ${BALANCE.minShoulderCounterTiltDeg}-${BALANCE.maxShoulderCounterTiltDeg} deg`);
  const freeToe = restWorld[FREE.replace('Foot', 'Toes')].p[1] - restWorld[STAND.replace('Foot', 'Toes')].p[1];
  stats.balance.freeToeAboveGroundCm = +(freeToe * 100).toFixed(2);
  if (freeToe < BALANCE.freeToeAboveGroundM[0] || freeToe > BALANCE.freeToeAboveGroundM[1]) v('balance', 'rest', `free toe ${(freeToe * 100).toFixed(1)} cm above the standing sole (allowed ${BALANCE.freeToeAboveGroundM.map((x) => x * 100)})`);
  // hand-on-hip contact
  const tipD = pelvisDist(restWorld, restWorld.leftHandTip.p), wrD = pelvisDist(restWorld, restWorld.leftHand.p);
  stats.contact = { tipToPelvisCm: tipD === null ? null : +(tipD * 100).toFixed(2), wristToPelvisCm: wrD === null ? null : +(wrD * 100).toFixed(2) };
  if (tipD === null || tipD > BODY.contactTipM || tipD < -0.005) v('contact', 'rest.leftHandTip', `fingertip ${tipD === null ? 'is outside the pelvis height band' : (tipD * 100).toFixed(1) + ' cm from the pelvis surface'} (allowed -0.5..${BODY.contactTipM * 100} cm)`);
  if (wrD === null || wrD > BODY.contactWristM || wrD < 0) v('contact', 'rest.leftHand', `wrist ${wrD === null ? 'is outside the pelvis height band' : (wrD * 100).toFixed(1) + ' cm from the pelvis surface'} (allowed 0..${BODY.contactWristM * 100} cm)`);
  let worst = 0;
  for (let T = 0; T < 20000; T += 1000 / 30) {
    const P = idleOnly(spec, T), W = fk(P.pose, P.hipsOffset), d = pelvisDist(W, W.leftHandTip.p);
    if (d === null || d > BODY.contactIdleM || d < -0.01) { v('contact', `idle @${Math.round(T)}ms`, `fingertip leaves the hip during idle (${d === null ? 'out of band' : (d * 100).toFixed(1) + ' cm'})`); break; }
    worst = Math.max(worst, Math.abs(d));
  }
  stats.contact.idleWorstCm = +(worst * 100).toFixed(2);
}
if (!(spec.idle?.rampMs >= MOTION.idleRampMinMs)) v('layerSeam', 'idle.rampMs', `idle weight ramp ${spec.idle?.rampMs ?? 0} ms (< ${MOTION.idleRampMinMs}): the pose steps when a clip starts or ends`);

// ---------------------------------------------------------------- frame fit
const toPx = (p) => [spec.frame.originXPx + p[0] * px, spec.frame.originYPx - p[1] * px];
const fitBox = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
function frameFit(W, w) {
  if (!px) return;
  const m = FRAME.skinMarginM * px;
  for (const [b, j] of Object.entries(W)) {
    const q = toPx(project(j.p, yaw));
    fitBox.x0 = Math.min(fitBox.x0, q[0] - m); fitBox.x1 = Math.max(fitBox.x1, q[0] + m); fitBox.y0 = Math.min(fitBox.y0, q[1] - m); fitBox.y1 = Math.max(fitBox.y1, q[1] + m);
    if (q[0] - m < -0.5 || q[0] + m > FRAME.w + 0.5 || q[1] - m < -0.5 || q[1] + m > FRAME.h + 0.5) return `${b} at (${q[0].toFixed(1)}, ${q[1].toFixed(1)}) px plus a ${m.toFixed(1)} px skin margin leaves the ${FRAME.w}x${FRAME.h} frame`;
  }
  return null;
}
if (!px) v('frameFit', 'frame', 'spec has no frame.pxPerM / originXPx / originYPx');
else {
  let y0 = Infinity, y1 = -Infinity;
  for (const j of Object.values(restWorld)) { y0 = Math.min(y0, j.p[1]); y1 = Math.max(y1, j.p[1]); }
  const fill = (y1 - y0 + 2 * FRAME.skinMarginM) * px / FRAME.h;
  stats.frame = { pxPerM: px, restFill: +fill.toFixed(3) };
  if (fill < FRAME.minRestFill || fill > FRAME.maxRestFill) v('frameFit', 'rest', `rest figure fills ${(fill * 100).toFixed(1)} % of the frame height (allowed ${FRAME.minRestFill * 100}-${FRAME.maxRestFill * 100} %): she would shrink on screen`);
  const f = frameFit(restWorld);
  if (f) v('frameFit', 'rest', f);
}

// ---------------------------------------------------------------- 2D part declarations
const parts = spec.twoD?.parts ?? {};
if (spec.budget?.ships === 'layered2d') {
  for (const [n, a, b] of LIMB_PARTS) {
    const p = parts[n];
    if (!p?.variants?.length) { v('layerForeshorten', n, 'limb part has no drawing variants'); continue; }
    const len = Math.hypot(...BONES[b][1]);
    if (p.h < TWO_D.minPartLenShare * 2 * px * len) v('budget', `twoD.${n}`, `drawing ${p.h} px long, shorter than ${TWO_D.minPartLenShare * 100} % of its ${(len * 100).toFixed(0)} cm bone at 2x (${(2 * px * len).toFixed(0)} px): the atlas estimate is too small`);
  }
  for (const n of ['head', 'torso', 'pelvis']) if (!parts[n]?.yawViews?.length || !parts[n]?.pitchViews?.length) v('layerViews', n, 'turn part has no views');
}
const viewMiss = (views, x) => Math.min(...views.map((a) => Math.abs(a - x)));
function check2D(s, t, L, once) {
  for (const [n] of LIMB_PARTS) {
    const p = parts[n], st = L.limbs[n];
    if (p?.variants && !pickVariant(p.variants, st.ratio, st.depth, TWO_D.maxScaleDev))
      once(`fs${n}`, 'layerForeshorten', `${where(s, t)} ${n}`, `projected length ${(st.ratio * 100).toFixed(0)} % (${st.depth > 0 ? 'toward' : 'away from'} the camera): no drawing within ${TWO_D.maxScaleDev * 100} %, a rotate-only layer would show it at the wrong length`);
  }
  for (const n of ['head', 'torso', 'pelvis']) {
    const p = parts[n], st = L.turns[n];
    if (!p?.yawViews?.length) continue;
    const yTol = n === 'head' ? TWO_D.headYawHalfStepDeg : TWO_D.noViewYawTolDeg, pTol = n === 'head' ? TWO_D.headPitchHalfStepDeg : TWO_D.noViewYawTolDeg;
    const my = viewMiss(p.yawViews, st.yaw), mp = viewMiss(p.pitchViews, st.pitch);
    if (my > yTol + 1e-6 || mp > pTol + 1e-6) once(`vw${n}`, 'layerViews', `${where(s, t)} ${n}`, `turned to yaw ${st.yaw.toFixed(1)} / pitch ${st.pitch.toFixed(1)} deg; nearest view is ${my.toFixed(1)} / ${mp.toFixed(1)} deg away (allowed ${yTol} / ${pTol}): the turn would not show`);
  }
}

// ---------------------------------------------------------------- per section
const bodyKeys = new Set(), faceKeys = new Set();
const SF = spec.budget?.runtimes?.sprite ?? {};
const sfps = SF.fps ?? 5, q = SF.quantizeDeg ?? 4, qm = SF.quantizeMetres ?? 0.004, qw = spec.budget?.faceOverlay?.quantizeWeight ?? 0.25;
const startValue = (tr) => tr[0][1], endValue = (tr) => tr[tr.length - 1][1];

function tracksOf(c) {
  const out = [];
  for (const [b, tr] of Object.entries(c.bones ?? {})) out.push([`bone:${b}`, tr]);
  for (const [k, tr] of Object.entries(c.expressions ?? {})) out.push([`expr:${k}`, tr]);
  for (const [k, tr] of Object.entries(c.fingers ?? {})) out.push([`fingers:${k}`, tr]);
  if (c.gaze) out.push(['gaze', c.gaze]);
  if (c.hipsOffset) out.push(['hipsOffset', c.hipsOffset]);
  return out;
}
/** pop and easeFrames on frames sampled at f fps; report through `rep`. */
function shownFrames(s, f, rep, label) {
  const c = s.clip, dur = clipDuration(c);
  const startsAtRest = s.part === 'oneShot' || s.part === 'enter', endsAtRest = s.part === 'oneShot' || s.part === 'exit';
  const step = 1000 / f, baked = [];
  for (let t = 0; t <= dur + 0.01; t += step) baked.push(C(s, Math.min(t, dur), 0, false));
  if (baked.length && Math.abs((baked.length - 1) * step - dur) > 1) baked.push(C(s, dur, 0, false));
  for (let i = 1; i < baked.length; i++) for (const b of ROTATING) {
    const d = rotAngle(baked[i].pose[b], baked[i - 1].pose[b]);
    if (d > MOTION.maxStepDeg) { rep('pop', `${where(s, i * step)} ${b}`, `${d.toFixed(1)} deg between two shown frames at ${f} fps${label} (> ${MOTION.maxStepDeg})`); break; }
  }
  const mag = (P) => Math.sqrt([...ROTATING.map((b) => rotAngle(P.pose[b], restP.pose[b])), ...P.delta.root.map((x) => x * 500)].reduce((a, x) => a + x * x, 0));
  const m = baked.map(mag), peak = Math.max(...m);
  if (peak > 0.5 && s.parent.layer !== 'face') {
    const inb = (arr) => {
      const firstDrop = arr.findIndex((y, i) => i > 0 && y < arr[i - 1]);
      const firstPeak = Math.max(...arr.slice(0, Math.max(2, firstDrop + 1 || arr.length)));
      return Math.max(0, arr.findIndex((x) => x >= 0.9 * firstPeak) - 1);
    };
    if (startsAtRest) {
      const n = inb(m);
      if (n < MOTION.minEaseFrames) rep('easeFrames', where(s, 0), `only ${n} in-between frame(s) at ${f} fps${label} before the first pose (need ${MOTION.minEaseFrames})`);
      if (m.length > 2 && m[1] > (m[2] - m[1]) + 0.01 * peak && m[1] > 0.05 * peak) rep('easeFrames', where(s, 0), `leaves rest at full speed at ${f} fps${label}: no ease in`);
    }
    if (endsAtRest) {
      const back = [...m].reverse(), n = inb(back), k = m.length;
      if (n < MOTION.minEaseFrames) rep('easeFrames', where(s, dur), `only ${n} in-between frame(s) at ${f} fps${label} before rest (need ${MOTION.minEaseFrames})`);
      if (k > 2 && m[k - 2] > (m[k - 3] - m[k - 2]) + 0.01 * peak && m[k - 2] > 0.05 * peak) rep('easeFrames', where(s, dur), `arrives at rest at full speed at ${f} fps${label}: no ease out`);
    }
  }
  return baked.length;
}

for (const s of sections) {
  const c = s.clip, dur = clipDuration(c);
  if (!(dur > 0)) { v('structure', where(s), 'zero duration'); continue; }
  const tracks = tracksOf(c);
  for (const [id, tr] of tracks) {
    if (!Array.isArray(tr) || tr.length < 2) { v('structure', `${where(s)} ${id}`, 'track needs at least two keys'); continue; }
    if (tr[0][0] !== 0) v('structure', `${where(s)} ${id}`, `first key at ${tr[0][0]} ms, must be 0`);
    for (let i = 1; i < tr.length; i++) if (!(tr[i][0] > tr[i - 1][0])) v('structure', `${where(s)} ${id}`, `key times not increasing at index ${i}`);
    if (tr[tr.length - 1][0] > dur + 1) v('structure', `${where(s)} ${id}`, 'key after the clip end');
  }
  const startsAtRest = s.part === 'oneShot' || s.part === 'enter', endsAtRest = s.part === 'oneShot' || s.part === 'exit';
  for (const [id, tr] of tracks) {
    if (!Array.isArray(tr) || tr.length < 2) continue;
    if (startsAtRest && !isZero(startValue(tr))) v('restEnds', `${where(s, 0)} ${id}`, `starts at ${JSON.stringify(startValue(tr))}, not rest`);
    if (endsAtRest && !isZero(endValue(tr))) v('restEnds', `${where(s, dur)} ${id}`, `ends at ${JSON.stringify(endValue(tr))}, not rest`);
  }
  // idle -> section and section -> idle: no step when the clip takes over or lets go
  for (let T = 0; T < 20000; T += 250) {
    const pairs = [];
    if (startsAtRest) pairs.push([C(s, 0, T), idleOnly(spec, T), 0]);
    if (endsAtRest) pairs.push([C(s, dur, T), idleOnly(spec, T + dur), dur]);
    let hit = false;
    for (const [A, B, t] of pairs) {
      const d = Math.max(...ROTATING.map((b) => rotAngle(A.pose[b], B.pose[b])));
      if (d > MOTION.layerSeamDeg) { v('layerSeam', where(s, t), `pose jumps ${d.toFixed(2)} deg between idle-only and the section at its rest end (idle phase ${T} ms); ramp the idle weight`); hit = true; break; }
    }
    if (hit) break;
  }

  // dense sampling: ranges, velocity, silhouette, penetration, feet, balance, frame, 2D, frozen holds
  const dt = 1000 / 60, N = Math.ceil(dur / dt);
  const airborneUntil = s.parent.airborne ? (s.part === 'exit' ? (c.groundContactAt ?? dur) : Infinity) : -1;
  let first = [];
  for (const idleT of [0, 1500, 3100]) {
    let prev = null;
    const hist = [];
    const reported = new Set();
    const once = (key, rule, w, msg) => { if (!reported.has(key)) { reported.add(key); v(rule, w, msg); } };
    for (let i = 0; i <= N; i++) {
      const t = Math.min(dur, i * dt);
      const P = C(s, t, idleT);
      if (idleT === 0) {
        for (const [b, lim] of Object.entries(LIMITS)) ['x', 'y', 'z'].forEach((ax, k) => {
          const val = P.pose[b][k];
          if (val < lim[ax][0] - 0.05 || val > lim[ax][1] + 0.05) {
            const rule = /LowerArm/.test(b) && ax !== 'y' ? 'hinge' : 'jointRange';
            once(`r${b}${ax}`, rule, `${where(s, t)} ${b}.${ax}`, rule === 'hinge' ? `${val.toFixed(1)} deg: the elbow is a hinge, X/Z must stay within ${lim[ax]} (twist belongs in upperArm.x or hand.x)` : `${val.toFixed(1)} outside human range ${lim[ax]}`);
          }
        });
        for (const [k, w] of Object.entries(P.expr)) if (w < -0.05 || w > 1.05) once(`e${k}`, 'exprRange', `${where(s, t)} ${k}`, `weight ${w.toFixed(2)} outside 0..1`);
        if (Math.abs(P.gaze[0]) > MOTION.gaze.yaw || Math.abs(P.gaze[1]) > MOTION.gaze.pitch) once('gaze', 'gazeRange', where(s, t), `gaze ${P.gaze.map((x) => x.toFixed(1))} beyond ${MOTION.gaze.yaw}/${MOTION.gaze.pitch}`);
        for (const side of ['left', 'right']) if (P.fingers[side].some((x) => x < -0.2 || x > 1.05)) once(`f${side}`, 'fingerRange', `${where(s, t)} fingers.${side}`, `${P.fingers[side].map((x) => x.toFixed(2))} outside -0.2..1`);
        for (const b of RIGHT_ARM) {
          const d = P.delta.pose[b];
          if (d && maxAbs(d) > MOTION.rightArmMaxDeltaDeg) once(`ra${b}`, 'leftArmOnly', `${where(s, t)} ${b}`, `right arm moves ${maxAbs(d).toFixed(1)} deg from rest (> ${MOTION.rightArmMaxDeltaDeg}); gestures use the left arm`);
        }
      }
      const W = fk(P.pose, P.hipsOffset);
      for (const b of Object.keys(W)) {
        const x = project(W[b].p, yaw)[0];
        if (x < silhouetteEdge - MOTION.silhouetteTolM) once(`sil${b}`, RIGHT_ARM_SITES.includes(b) || b === 'rightUpperArm' ? 'rightSilhouette' : 'edgeSilhouette', `${where(s, t)} ${b}`,
          `${((silhouetteEdge - x) * 100).toFixed(1)} cm past the rest silhouette edge (tolerance ${MOTION.silhouetteTolM * 100} cm)`);
      }
      // hands through the body: ribcage above the waist, pelvis profile below
      for (const side of ['left', 'right']) for (const [site, p] of handSites(W, side)) {
        const te = torsoE(W, p, P.hipsOffset[1] - (rest.hipsOffset?.[1] ?? 0)), pe = pelvisE(W, p);
        if (te !== null && te < BODY.penetrationE) once(`pen${site}`, 'penetration', `${where(s, t)} ${site}`, `inside the torso (ellipse value ${te.toFixed(2)} < ${BODY.penetrationE})`);
        else if (pe !== null && pe < BODY.penetrationE) once(`pen${site}`, 'penetration', `${where(s, t)} ${site}`, `inside the pelvis (ellipse value ${pe.toFixed(2)} < ${BODY.penetrationE})`);
      }
      if (t >= airborneUntil) {
        for (const f of ['leftFoot', 'rightFoot']) {
          const p = W[f].p, r = restWorld[f].p;
          const slide = Math.hypot(p[0] - r[0], p[2] - r[2]);
          if (slide > MOTION.footSlideM) once(`slide${f}`, 'footPlant', `${where(s, t)} ${f}`, `foot slides ${(slide * 100).toFixed(1)} cm (> ${MOTION.footSlideM * 100})`);
          if (p[1] < r[1] - 0.006) once(`sink${f}`, 'footPlant', `${where(s, t)} ${f}`, `foot ${((r[1] - p[1]) * 100).toFixed(1)} cm below where it stands`);
        }
        const d = groundDist(centreOfMass(W), supportOf(W, STAND));
        if (d > BALANCE.comTolM) once('bal', 'balance', where(s, t), `centre of mass ${(d * 100).toFixed(1)} cm from the standing foot (> ${BALANCE.comTolM * 100}): she would tip over`);
      }
      if (idleT === 0) {
        const f = frameFit(W);
        if (f) once('fit', 'frameFit', where(s, t), f);
        if (i % 2 === 0 && spec.budget?.ships === 'layered2d') check2D(s, t, layerState(P, yaw), once);
      }
      if (prev) {
        for (const b of ROTATING) {
          const d = rotAngle(P.pose[b], prev.pose[b]) / (dt / 1000);
          if (d > (VEL[b] ?? 300)) once(`vel${b}`, 'velocity', `${where(s, t)} ${b}`, `${d.toFixed(0)} deg/s > ${VEL[b]}`);
        }
        for (const k of Object.keys(P.expr)) {
          const d = Math.abs(P.expr[k] - (prev.expr[k] ?? 0)) / (dt / 1000);
          if (d > MOTION.exprVelPerS) once(`ev${k}`, 'velocity', `${where(s, t)} expr ${k}`, `${d.toFixed(1)}/s > ${MOTION.exprVelPerS}`);
        }
      }
      prev = P;
      hist.push({ t, P, W });
    }
    // frozen holds (composite, with idle running): angles, and the drawn 2D output in px
    const chans = (P) => ROTATING.flatMap((b) => P.pose[b]);
    const sites = (W) => drawnPoints(W, yaw, px);
    const win = Math.round(MOTION.frozenWindowMs / dt);
    for (let i = 0; i + win < hist.length; i++) {
      const a = chans(hist[i].P), a2 = sites(hist[i].W);
      let mx = 0, ex = 0, pm = 0;
      for (let j = i + 1; j <= i + win; j++) {
        const b = chans(hist[j].P), b2 = sites(hist[j].W);
        for (let k = 0; k < a.length; k++) mx = Math.max(mx, Math.abs(b[k] - a[k]));
        for (let k = 0; k < a2.length; k++) pm = Math.max(pm, Math.abs(b2[k] - a2[k]));
        for (const k of Object.keys(hist[i].P.expr)) ex = Math.max(ex, Math.abs(hist[j].P.expr[k] - hist[i].P.expr[k]));
      }
      if (mx < MOTION.frozenDeg && ex < MOTION.frozenExpr) { once('frozen', 'frozenHold', where(s, hist[i].t), `nothing moves more than ${MOTION.frozenDeg} deg for ${MOTION.frozenWindowMs} ms even with the idle layer`); break; }
      if (px && pm < TWO_D.minPx && ex < MOTION.frozenExpr) { once('frozen2d', 'frozenHold', where(s, hist[i].t), `no drawn joint moves ${TWO_D.minPx} px (1x) in ${MOTION.frozenWindowMs} ms`); break; }
    }
    if (idleT === 0) first = hist;
  }
  // action-only stillness: authored holds must drift
  if (c.bones && Object.keys(c.bones).length) {
    let stillFrom = 0, prevD = null;
    for (const { t } of first) {
      const Dd = actionAt(c, t);
      const vec = [...Object.values(Dd.pose).flat(), ...Object.values(Dd.expr).map((x) => x * 30), Dd.gaze[0], Dd.gaze[1]];
      if (prevD) {
        const mv = Math.max(...vec.map((x, k) => Math.abs(x - prevD[k])));
        if (mv > 0.02) stillFrom = t;
        else if (t - stillFrom > MOTION.actionFrozenMs && !(startsAtRest && stillFrom === 0 && t < 200)) {
          v('frozenHold', where(s, stillFrom), `authored tracks stand still for over ${MOTION.actionFrozenMs} ms; add a drift key so the hold lives`);
          break;
        }
      }
      prevD = vec;
    }
  }
  // shown frames of the shipped runtime, and of the degraded sprite fallback at its own fps
  const shippedSprite = spec.budget?.ships === 'sprite';
  shownFrames(s, shippedSprite ? sfps : fps, v, '');
  if (!shippedSprite) shownFrames(s, sfps, fb, ' (sprite fallback)');
  const spriteTimes = [...Array(Math.floor(dur * sfps / 1000) + 1).keys()].map((i) => i * 1000 / sfps).concat([dur]);
  for (const t of spriteTimes) {
    const P = C(s, t, 0, false);
    const key = ROTATING.map((b) => P.pose[b].map((x) => Math.round(x / q)).join(',')).join('|') + '|' + P.hipsOffset.map((x) => Math.round(x / qm)).join(',');
    if (s.parent.layer !== 'face') bodyKeys.add(key);
    faceKeys.add(Object.entries(P.expr).filter(([, w]) => w > qw / 2).map(([k, w]) => `${k}${Math.round(Math.min(1, w) / qw)}`).sort().join(',') + `|g${Math.round(P.gaze[0] / 8)},${Math.round(P.gaze[1] / 8)}`);
  }
  stats[where(s)] = { durationMs: dur };
}

// idle-only 2D output: standing still must still move on screen (the shipped rig evaluates idle live)
{
  const hist = [];
  // Standing idle over one full idle cycle (LCM of the layer periods) when that is under 20 min, so the
  // result holds for all time; otherwise 300 s.
  const gcd = (x, y) => (y ? gcd(y, x % y) : x);
  const lcm = (spec.idle?.layers ?? []).reduce((a, l) => (a * Math.round(l.periodMs)) / gcd(a, Math.round(l.periodMs)), 1);
  const horizon = lcm <= 1_200_000 ? lcm + MOTION.frozenWindowMs + 100 : 300000;
  for (let T = 0; T <= horizon; T += 1000 / 30) { const P = idleOnly(spec, T); hist.push({ T, s: drawnPoints(fk(P.pose, P.hipsOffset), yaw, px) }); }
  const win = Math.round(MOTION.frozenWindowMs / (1000 / 30));
  let minMove = Infinity;
  for (let i = 0; i + win < hist.length; i++) {
    let pm = 0;
    for (let j = i + 1; j <= i + win; j++) for (let k = 0; k < hist[i].s.length; k++) pm = Math.max(pm, Math.abs(hist[j].s[k] - hist[i].s[k]));
    minMove = Math.min(minMove, pm);
    if (pm < TWO_D.minPx) { v('frozenHold', `idle @${Math.round(hist[i].T)}ms`, `standing idle: no drawn joint moves ${TWO_D.minPx} px (1x) in ${MOTION.frozenWindowMs} ms`); break; }
  }
  stats.idle2d = { minPxMovedPer600ms: +minMove.toFixed(3), testedMs: Math.round(horizon), fullCycle: lcm <= 1_200_000 };
  // The sprite fallback's idle: breathFrames cycled over the breath period, nothing else.
  const bf = spec.idle?.spriteBake?.breathFrames ?? 0, period = spec.idle?.layers?.find((l) => l.name === 'breath')?.periodMs ?? 4200;
  const cycle = bf > 1 ? 2 * (bf - 1) : 1, hold = period / cycle;
  if (hold >= MOTION.frozenWindowMs) (spec.budget?.ships === 'sprite' ? v : fb)('frozenHold', 'sprite idle', `standing idle holds each of ${bf} breath frames ${Math.round(hold)} ms (>= ${MOTION.frozenWindowMs}); weight sway and head drift are lost`);
}

// stateful seams
for (const [name, clip] of Object.entries(spec.clips ?? {})) {
  if (clip.kind !== 'stateful' || !clip.enter || !clip.loop || !clip.exit) continue;
  const seam = (a, pa, ta, b, pb, tb, label) => {
    const A = C({ name, part: pa, clip: a, parent: clip }, ta, 0, false), B = C({ name, part: pb, clip: b, parent: clip }, tb, 0, false);
    for (const bn of ROTATING) { const d = maxAbs(A.pose[bn].map((x, k) => x - B.pose[bn][k])); if (d > 0.5) { v('seam', `${name} ${label} ${bn}`, `jumps ${d.toFixed(1)} deg`); break; } }
    for (const k of new Set([...Object.keys(A.expr), ...Object.keys(B.expr)])) if (Math.abs((A.expr[k] ?? 0) - (B.expr[k] ?? 0)) > 0.03) v('seam', `${name} ${label} expr ${k}`, 'jumps');
    if (Math.abs(A.gaze[0] - B.gaze[0]) + Math.abs(A.gaze[1] - B.gaze[1]) > 1) v('seam', `${name} ${label} gaze`, 'jumps');
    if (maxAbs(A.hipsOffset.map((x, k) => x - B.hipsOffset[k])) > 0.002) v('seam', `${name} ${label} hipsOffset`, 'jumps');
  };
  seam(clip.enter, 'enter', clipDuration(clip.enter), clip.loop, 'loop', 0, 'enter->loop');
  seam(clip.loop, 'loop', clipDuration(clip.loop), clip.loop, 'loop', 0, 'loop end->loop start');
  seam(clip.loop, 'loop', clipDuration(clip.loop), clip.exit, 'exit', 0, 'loop->exit');
}

// ---------------------------------------------------------------- agreed set and state machine
const agreed = new Set(Object.values(spec.clips ?? {}).map((c) => c.agreed).filter(Boolean));
for (const a of AGREED) if (!agreed.has(a)) v('coverage', a, 'agreed action has no clip');
const sm = spec.stateMachine ?? {};
const ev = sm.events ?? {};
for (const e of REQUIRED_EVENTS) if (!ev[e]) v('stateMachine', e, 'required app event is not bound');
for (const [name, e] of Object.entries(ev)) {
  for (const c of [e.clip, e.then, e.greet?.clip, ...(e.pick ?? []).map((p) => p[0])].filter(Boolean)) if (!spec.clips?.[c]) v('stateMachine', name, `clip "${c}" does not exist`);
  if (e.exits && spec.clips?.[e.exits]?.kind !== 'stateful') v('stateMachine', name, `exits "${e.exits}" which is not a stateful clip`);
  if ((e.clip || e.pick) && typeof e.priority !== 'number') v('stateMachine', name, 'clip event without a numeric priority');
  if (e.hold?.startsWith('untilEvent:')) {
    const target = e.hold.slice(11);
    if (!ev[target]) v('stateMachine', name, `holds until "${target}", which is not an event`);
    else if (ev[target].exits !== e.clip) v('stateMachine', name, `"${target}" does not exit ${e.clip}`);
  }
  if (spec.clips?.[e.clip]?.kind === 'stateful' && !e.hold) v('stateMachine', name, `stateful ${e.clip} has no hold rule`);
  const cds = typeof e.cooldownMs === 'object' ? Object.values(e.cooldownMs) : [e.cooldownMs ?? 0];
  if (cds.some((x) => !(x >= 0))) v('stateMachine', name, 'negative or invalid cooldown');
}
if (!((ev.dragStart?.priority ?? 0) > (ev.longIdle?.priority ?? 0) && (ev.longIdle?.priority ?? 0) > Math.max(...Object.entries(ev).filter(([k]) => !['dragStart', 'longIdle', 'quietHours'].includes(k)).map(([, e]) => e.priority ?? 0))))
  v('stateMachine', 'priorities', 'drag must outrank sleep and sleep must outrank every other clip');
// queue expiry covers the longest one-shot and every locked chain
{
  const cd = (n) => (spec.clips?.[n] ? clipDuration(spec.clips[n].kind === 'stateful' ? spec.clips[n].exit ?? {} : spec.clips[n]) : 0);
  const oneShots = Object.entries(spec.clips ?? {}).filter(([, c]) => c.kind !== 'stateful').map(([, c]) => clipDuration(c));
  const chains = Object.entries(ev).filter(([, e]) => e.locks).map(([n, e]) => [n, (e.exits ? cd(e.exits) : 0) + (e.clip ? cd(e.clip) : 0) + (e.then ? cd(e.then) : 0)]);
  const need = Math.max(...oneShots, ...chains.map((x) => x[1]));
  const exp = sm.interrupt?.queue?.expiryMs ?? 0;
  stats.queue = { expiryMs: exp, neededMs: need, longestChain: chains.sort((a, b) => b[1] - a[1])[0] };
  if (exp < need) v('queueExpiry', 'interrupt.queue.expiryMs', `${exp} ms < ${need} ms (longest one-shot or locked chain): a queued word would expire before the gesture ends`);
}
// behaviour scenarios that reproduce Pet.svelte's call order
stats.behaviour = {};
for (const [name, sc] of Object.entries(BEHAVIOUR.scenarios)) {
  let segs;
  try { segs = simulate(spec, sc.events); } catch (err) { v('behaviour', name, `scheduler failed: ${err.message}`); continue; }
  stats.behaviour[name] = segs.map((s) => `${s.clip}${s.part === 'oneShot' ? '' : '.' + s.part} ${Math.round(s.start)}-${Math.round(s.end)} ${s.how}`);
  for (const f of expectations(segs, sc.expect)) v('behaviour', name, f);
}

// ---------------------------------------------------------------- budget (caps from lib/limits.mjs)
const B = spec.budget ?? {};
const ships = B.ships;
const breath = spec.idle?.spriteBake?.breathFrames ?? 0;
const spriteFrames = bodyKeys.size + breath;
const cols = SF.columns ?? 10, rows = Math.ceil(spriteFrames / cols);
const spriteRam = cols * FRAME.w * rows * FRAME.h * 4;
const atlas = spec.twoD?.atlas ?? {};
const atlasPx = (atlas.w ?? 0) * (atlas.h ?? 0);
const limbArea = (p) => (p.variants ?? []).reduce((a, x) => a + (p.shapes?.length ?? 1) * (x.endOn ? p.w * p.w : Math.ceil(p.w * p.h * x.nominal)), 0);
const partsPx = Object.values(parts).reduce((a, p) => a + (p.kind === 'limb' ? limbArea(p) : p.w * p.h * (p.yawViews?.length ?? 1) * (p.pitchViews?.length ?? 1)), 0)
  + (spec.twoD?.faceParts ?? []).reduce((a, p) => a + p.w * p.h * (p.count ?? 1), 0);
let vrmRam = null;
if (existsSync(ramPath)) { try { vrmRam = JSON.parse(readFileSync(ramPath, 'utf8')); } catch { vrmRam = null; } }
stats.budget = { ships, ramCapBytes: BUDGET.ramCapBytes, layered2d: { atlas: `${atlas.w}x${atlas.h}`, ramBytes: atlasPx * 4, partsPx, fill: +(partsPx / (atlasPx || 1)).toFixed(3) },
  sprite: { fps: sfps, frames: spriteFrames, sheet: `${cols * FRAME.w}x${rows * FRAME.h}`, ramBytes: spriteRam, estWebpBytes: Math.round(spriteFrames * (B.v4?.webpBytesPerFrame ?? 12321)), faceCells: faceKeys.size },
  vrm: vrmRam?.summary ?? 'not measured (run measure_ram.mjs)' };
if (!BUDGET.runtimes.includes(ships)) v('budget', 'ships', `ships "${ships}", not one of ${BUDGET.runtimes.join(', ')}`);
if (!(fps >= BUDGET.evalFps[0] && fps <= BUDGET.evalFps[1])) v('budget', `${ships}.evalFps`, `${fps} fps outside ${BUDGET.evalFps.join('-')}`);
if (ships === 'layered2d') {
  if (partsPx > BUDGET.atlasMaxFill * atlasPx) v('budget', 'twoD.atlas', `parts need ${partsPx} px, more than ${BUDGET.atlasMaxFill * 100} % of the ${atlas.w}x${atlas.h} atlas`);
  if (atlasPx * 4 > BUDGET.ramCapBytes) v('budget', 'layered2d.ram', `atlas ${atlasPx * 4} B decoded > cap ${BUDGET.ramCapBytes} B (v4 sheet)`);
}
if (ships === 'sprite') {
  if (spriteRam > BUDGET.ramCapBytes) v('budget', 'sprite.ram', `${spriteFrames} frames = ${spriteRam} B decoded > cap ${BUDGET.ramCapBytes} B`);
  if (faceKeys.size > BUDGET.maxFaceCells) v('budget', 'faceCells', `${faceKeys.size} face cells > ${BUDGET.maxFaceCells}`);
} else {
  if (spriteRam > BUDGET.ramCapBytes) fb('budget', 'sprite.ram', `${spriteFrames} frames at ${sfps} fps = ${spriteRam} B decoded, ${(spriteRam / BUDGET.ramCapBytes).toFixed(2)}x the cap`);
}
if (ships === 'vrm') {
  const d = vrmRam?.summary?.vrmDeltaBytes;
  if (!(d >= 0)) v('budget', 'vrm.ram', 'ships vrm but no RAM measurement (artifacts/ram.json)');
  else if (d > BUDGET.ramCapBytes) v('budget', 'vrm.ram', `measured ${d} B over the blank page > cap ${BUDGET.ramCapBytes} B; needs the lead's approval`);
}

// ---------------------------------------------------------------- report
for (const x of violations) console.log(`[${x.rule}] ${x.where}: ${x.msg}`);
const rules = [...new Set(violations.map((x) => x.rule))];
if (fallback.length) {
  console.log(`-- degraded sprite fallback (not shipped; reported, not failing): ${fallback.length} finding(s)`);
  for (const x of fallback) console.log(`   (fallback) [${x.rule}] ${x.where}: ${x.msg}`);
}
console.log(JSON.stringify(stats.budget));
console.log(violations.length ? `FAIL: ${violations.length} violation(s) in ${rules.length} rule(s): ${rules.join(', ')}` : `PASS: ${sections.length} sections, ${Object.keys(BEHAVIOUR.scenarios).length} behaviour scenarios, 0 violations (ships ${ships})`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ spec: specPath, violations, rules, fallback, stats }, null, 1));
process.exit(violations.length ? 1 : 0);
