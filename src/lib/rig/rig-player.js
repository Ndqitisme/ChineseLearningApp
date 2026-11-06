// Tieu Mai layered 2D rig player. Framework-free: one WebGL canvas, one decoded atlas, motion-spec.json and
// rig.json. The same code draws the live pet (startLoop) and the offline frames the art checks read
// (drawSection). Pose = the spec's composer (compose.js); the spec's 2D state (layer2d.js) is retargeted onto
// the art skeleton:
//   - every drawing is a grid mesh. Torso, pelvis, neck and the head are rigid, turned by the change of their
//     joint's roll from rest, with small secondary motion (hair, bow, skirt) as a lagged shear
//   - limbs are skinned meshes: each whole-arm drawing (upper arm, sleeve, forearm and hand
//     in one piece) and each leg (thigh, shin, shoe composited once) is one continuous texture, deformed by its
//     three bones with smooth weights across the elbow / knee and the wrist / ankle (linear-blend skinning)
//   - bone motion: each segment turns by the change of the spec's projected bone angle and stretches by the
//     change of its projected length (clamped to rig.stretch), from the drawing's own configuration
//   - the left arm has one drawing per key pose (rig.leftArm.keys). Angle and length offsets (art - spec at
//     each key's anchor) are blended by the spec arm's distance to each anchor; when the heaviest key changes,
//     the two drawings are posed on the same bones and cross-faded over fadeMs (one always opaque)
//   - the head: the front head (back hair, head, front hair, face swaps) and the turned views are cross-faded
//     by the head's yaw / pitch change; both are warped by the same turn (a cylinder about the head's centre
//     line), so the eyes and the glasses drawn on them move together
//   - planted feet: the ankle is pinned to its rest point and the shoe keeps its rest transform
//   - root motion (dip, lift, sway) is the spec's hips displacement times rig.kArt
// The scheduler (behaviour.js) decides what plays; Timeline re-runs it on the event log.
import { composite, idleOnly, sectionsOf, addOverlay } from './compose.js';
import { layerState } from './layer2d.js';
import { clipDuration, project, D2R, sampleTrack, activeIdleEvents } from './fk.js';
import { simulate, mouthAt, mulberry32, idleTickTimes } from './behaviour.js';

// ---------------------------------------------------------------- 2D affine [a, b, c, d, e, f]
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const T = (x, y) => [1, 0, 0, 1, x, y];
const R = (deg) => { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return [c, s, -s, c, 0, 0]; };
const S = (sx, sy) => [sx, 0, 0, sy, 0, 0];
const ID = [1, 0, 0, 1, 0, 0];
const ap = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const about = (p, deg, q = p) => mul(T(q[0], q[1]), mul(R(deg), T(-p[0], -p[1])));   // turn about p, then move p to q
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const dirOf = (deg) => [Math.cos(deg * D2R), Math.sin(deg * D2R)];
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scl2 = (a, k) => [a[0] * k, a[1] * k];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const seg = (a, b) => ({ A: a, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
/** Matrix taking a bone from its key (joint A, angle, length) to its pose (joint P, angle, length): stretch along the bone only. */
const boneMatrix = (key, P, angle, len) => mul(T(P[0], P[1]), mul(R(angle), mul(S(len / key.len, 1), mul(R(-key.angle), T(-key.A[0], -key.A[1])))));
/** Roll (canvas degrees, clockwise +) of a joint's frame as the camera sees it. */
function rollOf(W, joint, yaw) {
  const m = W[joint].m, up = project([m[1], m[4], m[7]], yaw);
  return -Math.atan2(-up[0], up[1]) / D2R;
}
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];
const segDist = (p, a, b) => {
  const ab = sub2(b, a), L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
  const u = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2, 0, 1);
  return Math.hypot(p[0] - a[0] - u * ab[0], p[1] - a[1] - u * ab[1]);
};

// Vertex: rest-frame position -> secondary shear (uSway: amount x, anchor y, depth; uBox limits it) -> head
// turn warp (uWarp: cx, cy, R, Rv; uSig: bump widths; uTurn: yaw, pitch in radians) -> three skinning matrices.
const VS = `attribute vec2 aPos; attribute vec2 aUv; attribute vec3 aW; attribute float aT;
uniform vec3 uM[8]; uniform vec2 uView; uniform vec3 uSway; uniform vec4 uBox; uniform vec4 uWarp; uniform vec2 uTurn; uniform vec2 uSig; uniform vec2 uChin;
varying vec2 vUv;
void main() {
  vec2 r = aPos;
  if (uSway.x != 0.0 && r.x >= uBox.x && r.x <= uBox.z && r.y >= uBox.y && r.y <= uBox.w) {
    float k = clamp((r.y - uSway.y) / uSway.z, 0.0, 1.0);
    r.x += uSway.x * k * k;
  }
  // turn warp: a smooth bump about the face centre moves the features by R sin(turn) and the outline hardly at
  // all (a cylinder model folds over at the far edge and doubles the hair there)
  if (uTurn.x != 0.0 || uTurn.y != 0.0) {
    vec2 d = (r - uWarp.xy) / uSig;
    // nothing below the chin moves: the jaw stays on the neck (a turned jaw bared the neck part's cut edge)
    float g = exp(-0.5 * dot(d, d)) * clamp((uChin.x - r.y) / uChin.y, 0.0, 1.0);
    r += vec2(uWarp.z * sin(uTurn.x), uWarp.w * sin(uTurn.y)) * g;
  }
  vec3 p = vec3(r, 1.0); vec2 q = vec2(0.0);
  q += aW.x * vec2(dot(uM[0], p), dot(uM[1], p));
  q += aW.y * vec2(dot(uM[2], p), dot(uM[3], p));
  q += aW.z * vec2(dot(uM[4], p), dot(uM[5], p));
  // aT: the sleeve cap's share tied to the torso (arm drawings only; 0 elsewhere)
  q = mix(q, vec2(dot(uM[6], p), dot(uM[7], p)), aT);
  gl_Position = vec4(q.x / uView.x * 2.0 - 1.0, 1.0 - q.y / uView.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;
// uSharp: the parts are 2x textures; magnified (4x offline frames) bilinear spreads a 1-texel edge over 4 px of
// partial alpha, which reads as a see-through rim inside the outline. The alpha ramp is steepened by the
// magnification so an edge stays about one device px wide at every scale.
const FS = `precision mediump float; uniform sampler2D uTex; uniform float uAlpha; uniform float uSharp; varying vec2 vUv;
void main() { vec4 t = texture2D(uTex, vUv); float a2 = clamp((t.a - 0.5) * uSharp + 0.5, 0.0, 1.0);
  gl_FragColor = (t.a > 0.0 ? t * (a2 / t.a) : t) * uAlpha; }`;
// Seam fill (post pass over the composited frame, premultiplied): where two soft part edges meet inside the body
// their alphas multiply to a pale see-through line, and a limb lying a hair off the flank leaves a 1-2 px sliver
// of desktop. A pixel below full alpha with opaque body within uR px on both sides along some
// direction gets that body colour composited under it. Outer outlines have background on one side and keep
// their antialiasing.
const QUAD_VS = `attribute vec2 aQ; varying vec2 vUv; void main() { vUv = aQ; gl_Position = vec4(aQ * 2.0 - 1.0, 0.0, 1.0); }`;
const FILL_FS = `precision mediump float; uniform sampler2D uSrc; uniform vec2 uPx; uniform float uR; uniform float uR0; varying vec2 vUv;
void main() {
  vec4 c = texture2D(uSrc, vUv);
  // with the sharpened edges a limb a hair off the skirt or the neck leaves a fully clear line; clear pixels
  // are filled too, but only across a hairline (uR0, a smaller reach than uR)
  float r = c.a > 0.15 ? uR : uR0;
  if (c.a < 0.97 && r >= 1.0) {
    vec4 fill = vec4(0.0);
    for (int k = 0; k < 4; k++) {
      vec2 d = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(0.0, 1.0) : k == 2 ? vec2(0.7071, 0.7071) : vec2(0.7071, -0.7071);
      vec4 a = vec4(0.0), b = vec4(0.0);
      for (int i = 1; i <= 8; i++) {
        if (float(i) > r) break;
        if (a.a < 0.97) { vec4 s = texture2D(uSrc, vUv + d * float(i) * uPx); if (s.a >= 0.97) a = s; }
        if (b.a < 0.97) { vec4 s = texture2D(uSrc, vUv - d * float(i) * uPx); if (s.a >= 0.97) b = s; }
      }
      if (a.a >= 0.97 && b.a >= 0.97) { fill = 0.5 * (a + b); break; }
    }
    c += (1.0 - c.a) * fill;
  }
  gl_FragColor = c;
}`;
const ARM_MAX_DEG_S = 900, ARM_MAX_PX_S = 120;   // left-arm pose filter rate caps (deg/s, 1x px/s): 30 deg, 4 px a frame
const CAP_R = 0.45;   // share of the upper arm over which the sleeve cap's tie to the torso fades out
const ARM_W = 60;    // rad/s: left-arm pose filter (critically damped; 95 % of a step in about 100 ms)
const FILL_R = 1.5;   // app px: gaps up to about 3 app px wide between opaque body are filled
const FILL_R0 = 1.0;  // app px: clear (alpha <= 0.15) gaps up to about 2 app px wide are filled (a limb resting on the body)
const NO_BOX = [-1e4, -1e4, 1e4, 1e4];

export class RigPlayer {
  /**
   * @param {object} o  { rig, spec, atlas (ImageBitmap, premultiplied), canvas, scale = 1 }
   * scale: device px per 1x app px (dpr live, 4 for the 4x offline frames).
   * hardWeights: offline checks only, rigid pieces (one bone per vertex), the defect the seam check must catch.
   */
  constructor({ rig, spec, atlas, canvas, scale = 1, hardWeights = false, xfade = false, idAtlas = null }) {
    this.rig = rig; this.spec = spec; this.canvas = canvas; this.scale = scale;
    this.hardWeights = hardWeights; this.xfade = xfade; this.idAtlas = idAtlas;
    canvas.width = Math.round(rig.frame.w * scale); canvas.height = Math.round(rig.frame.h * scale);
    this.yaw = spec.camera.yawDeg;
    this.sections = sectionsOf(spec);
    this.restP = composite(spec, { name: 'rest', part: 'loop', clip: {}, parent: {} }, 0, 0, false);
    this.L0 = this.specState(this.restP);
    this.stats = { frames: 0, clamped: {}, maxStretchDev: {}, pair: {}, fades: 0, headFades: 0 };
    this.resetMotion();
    this.initMeshes(atlas);
    this.initGL(atlas);
  }
  section(name, part = 'oneShot') { return this.sections.find((s) => s.name === name && s.part === part); }
  /** Clears the secondary-motion springs (a new clip, or a jump in time). */
  resetMotion() { this.springs = {}; this.lastT = null; this.armFade = null; this.armF = null; }
  /** True once every secondary-motion spring has come to rest (a held frame is then exactly the rest frame). */
  settled() { return Object.values(this.springs).every((s) => s.v === 0 && s.x === s.target) && (!this.armF || this.armF.every((b) => b.every((s) => s.v === 0 && s.x === s.target))); }
  /** Left-arm pose filter: [[angle, len] x3] targets -> filtered values (critically damped, omega ARM_W). */
  armSmooth(raw, t) {
    const dt = this.armF && this.armT !== undefined && t !== undefined ? clamp((t - this.armT) / 1000, 0, 0.1) : 0;
    if (t !== undefined) this.armT = t;
    if (!this.armF) this.armF = raw.map((b) => b.map((x) => ({ x, v: 0, target: x })));
    return this.armF.map((b, i) => b.map((s, j) => {
      // angles: follow the target along the short way round
      const target = j === 0 ? s.x + angDiff(raw[i][j], s.x) : raw[i][j];
      s.target = target;
      const x0 = s.x;
      for (let k = 0, n = Math.ceil(dt / 0.004); k < n; k++) {
        const h = dt / n, a = ARM_W * ARM_W * (target - s.x) - 2 * ARM_W * s.v;
        s.v += a * h; s.x += s.v * h;
      }
      // rate cap: where the spec forearm sweeps through end-on (55 deg in one frame, wave 10-12) the filter alone
      // still let 67 deg through in one frame
      const cap = (j === 0 ? ARM_MAX_DEG_S : ARM_MAX_PX_S) * dt;
      if (dt > 0 && Math.abs(s.x - x0) > cap) { s.x = x0 + Math.sign(s.x - x0) * cap; s.v = (s.x - x0) / dt; }
      const eps = j === 0 ? 0.02 : 0.0005;
      if (Math.abs(s.x - target) < eps && Math.abs(s.v) < 50 * eps) { s.x = target; s.v = 0; }
      return s.x;
    }));
  }

  // ------------------------------------------------------------ meshes: chain composites, grid meshes, weights
  initMeshes(atlas) {
    const rig = this.rig, PX = 2, CELL = 4, PAD = 3;
    const chainNames = Object.keys(rig.chains);
    const legParts = new Set(chainNames.flatMap((n) => rig.chains[n].parts ?? []));
    // leg composites: thigh, shin and shoe painted once into one texture at their rest places
    const comps = chainNames.filter((n) => rig.chains[n].parts).map((name) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const part of rig.chains[name].parts) { const p = rig.parts[part]; x0 = Math.min(x0, p.pos[0]); y0 = Math.min(y0, p.pos[1]); x1 = Math.max(x1, p.pos[0] + p.rect[2] / 2); y1 = Math.max(y1, p.pos[1] + p.rect[3] / 2); }
      x0 = Math.floor(x0) - PAD; y0 = Math.floor(y0) - PAD;
      return { name, origin: [x0, y0], w: Math.ceil((Math.ceil(x1) + PAD - x0) * PX / CELL) * CELL, h: Math.ceil((Math.ceil(y1) + PAD - y0) * PX / CELL) * CELL };
    });
    let cx = 0;
    for (const c of comps) { c.tex = [cx, 0]; cx += c.w + 4; }
    const CW = 512, CH = 2 ** Math.ceil(Math.log2(Math.max(...comps.map((c) => c.h)) + 1));
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(CW, CH) : Object.assign(document.createElement('canvas'), { width: CW, height: CH });
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    for (const c of comps) for (const part of rig.chains[c.name].parts) {
      const p = rig.parts[part];
      g.drawImage(atlas, p.rect[0], p.rect[1], p.rect[2], p.rect[3], c.tex[0] + (p.pos[0] - c.origin[0]) * PX, c.tex[1] + (p.pos[1] - c.origin[1]) * PX, p.rect[2], p.rect[3]);
    }
    // the atlas pixels, read once for the opaque-cell masks of atlas meshes
    const acv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(atlas.width, atlas.height) : Object.assign(document.createElement('canvas'), { width: atlas.width, height: atlas.height });
    const ag = acv.getContext('2d', { willReadFrequently: true });
    ag.drawImage(atlas, 0, 0);
    const [AW, AH] = rig.atlas.size;
    /** Grid mesh over the opaque cells of a texture region: { tex: 'atlas'|'comp', rect [x,y,w,h] in tex px, origin (frame px of the region's corner), bones? } */
    const gridMesh = ({ img, imgW, rect, origin, texSize, bones, cell, sleeve = false, byBone = false, cap = false, wy = null }) => {
      const [rx, ry, rw, rh] = rect, gw = Math.ceil(rw / cell), gh = Math.ceil(rh / cell);
      const used = new Uint8Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        let any = 0;
        for (let yy = Math.max(0, j * cell - 1); yy < Math.min(rh, (j + 1) * cell + 1) && !any; yy++) for (let xx = Math.max(0, i * cell - 1); xx < Math.min(rw, (i + 1) * cell + 1); xx++) if (img[((ry + yy) * imgW + rx + xx) * 4 + 3]) { any = 1; break; }
        used[j * gw + i] = any;
      }
      const vid = new Int32Array((gw + 1) * (gh + 1)).fill(-1), pos = [], uv = [], wt = [], wtT = [], idx = [];
      /** Share of opaque texels within 4 tex px of (x, y) that are shirt white (light, nearly grey). */
      const whiteShare = (x, y) => {
        let n = 0, wn = 0;
        for (let yy = Math.max(ry, y - 4); yy <= Math.min(ry + rh - 1, y + 4); yy++) for (let xx = Math.max(rx, x - 4); xx <= Math.min(rx + rw - 1, x + 4); xx++) {
          const o = (yy * imgW + xx) * 4;
          if (img[o + 3] < 128) continue;
          n++;
          const mx = Math.max(img[o], img[o + 1], img[o + 2]), mn = Math.min(img[o], img[o + 1], img[o + 2]);
          if (mn >= 200 && mx - mn <= 30) wn++;
        }
        return n ? wn / n : 0;
      };
      const vert = (i, j) => {
        const k = j * (gw + 1) + i;
        if (vid[k] >= 0) return vid[k];
        // the last row and column stop at the region's edge: a cell past it would sample the neighbouring
        // atlas part (a stray line beside the head, forearm tears from sleeve texels)
        const u = Math.min(i * cell, rw), v = Math.min(j * cell, rh);
        const p = [origin[0] + u / PX, origin[1] + v / PX];
        let w = [1, 0, 0];
        if (wy) { const t = wy(p[1]); w = [1 - t, t, 0]; }
        if (bones) {
          const d = bones.map((b) => segDist(p, b.A, add2(b.A, scl2(dirOf(b.angle), b.len))));
          w = this.hardWeights ? d.map((x) => (x === Math.min(...d) ? 1 : 0)) : d.map((x) => 1 / (x * x + 4) ** 2);
          let s = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / s);
          // bounded influence: a bone under 3 % has none, so a planted shoe below the ankle blend zone is exactly rigid
          w = w.map((x) => (x < 0.03 ? 0 : x)); s = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / s);
          // the sleeve rides the upper arm alone (a sleeve weighted to the forearm stretched into a white tube
          // or a flap): shirt-white texels around the vertex pull its weight to the upper arm
          if (sleeve) {
            const k = clamp((whiteShare(rx + u, ry + v) - 0.15) / 0.3, 0, 1);
            if (k > 0) w = [w[0] + (1 - w[0]) * k, w[1] * (1 - k), w[2] * (1 - k)];
          }
        }
        // cap: the sleeve cap around the shoulder joint is tied to the torso, fading out over CAP_R of the upper
        // arm (turned about the shoulder, the cap's top corner stuck up as a spike or left the torso's armhole
        // edge as a step)
        let wT = 0;
        if (cap) { const dS = Math.hypot(p[0] - bones[0].A[0], p[1] - bones[0].A[1]); wT = clamp(1 - dS / (CAP_R * bones[0].len), 0, 1) ** 2; }
        vid[k] = pos.length / 2; pos.push(p[0], p[1]); uv.push((rx + u) / texSize[0], (ry + v) / texSize[1]); wt.push(w[0], w[1], w[2]); wtT.push(wT);
        return vid[k];
      };
      const quads = [];
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (used[j * gw + i]) {
        const q = [vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)];
        // draw order inside one skinned drawing: by bone (upper arm, forearm, hand), so where a bend folds the
        // mesh the forearm and hand lie over the upper arm and sleeve (in think the fist rows came first in
        // texture order and the sleeve was drawn over the fist)
        const depth = q.reduce((sum, v) => sum + wt[3 * v + 1] + 2 * wt[3 * v + 2], 0);
        quads.push([depth, quads.length, q]);
      }
      if (byBone) quads.sort((x, y) => x[0] - y[0] || x[1] - y[1]);   // arms only: a leg's shin lies under its thigh
      for (const [, , [a, b, c, d]] of quads) idx.push(a, b, c, a, c, d);
      return { pos: new Float32Array(pos), uv: new Float32Array(uv), wt: new Float32Array(wt), wtT: new Float32Array(wtT), idx: new Uint16Array(idx) };
    };
    const compImg = g.getImageData(0, 0, CW, CH).data, atlasImg = ag.getImageData(0, 0, AW, AH).data;
    this.meshes = {};
    this.chains = {};
    for (const name of chainNames) {
      const ch = rig.chains[name], bones = ch.bones.map(([a, b]) => seg(a, b));
      const c = comps.find((x) => x.name === name);
      const mesh = c ? gridMesh({ img: compImg, imgW: CW, rect: [c.tex[0], c.tex[1], c.w, c.h], origin: c.origin, texSize: [CW, CH], bones, cell: CELL })
        : gridMesh({ img: atlasImg, imgW: AW, rect: rig.parts[ch.part].rect, origin: rig.parts[ch.part].pos, texSize: [AW, AH], bones, cell: CELL, sleeve: !this.hardWeights && /Arm\./.test(name), byBone: /Arm\./.test(name), cap: !this.hardWeights && /^leftArm\./.test(name) });
      this.meshes[name] = { ...mesh, tex: c ? 'comp' : 'atlas' };
      this.chains[name] = { name, z: ch.z, bones };
    }
    for (const [name, p] of Object.entries(rig.parts)) {
      if (legParts.has(name) || rig.chains[name]) continue;
      // the ponytail (backHair) hangs behind the neck's edge onto the collar: its top rides the head, its tip the torso
      // (second matrix), so a pitched or rolled head keeps the overlap and opens no pale seam beside the neck
      const wy = name === 'backHair' ? (y) => smooth((y - p.pos[1] - 2) / (p.rect[3] / PX - 6)) : null;
      this.meshes[name] = { ...gridMesh({ img: atlasImg, imgW: AW, rect: p.rect, origin: p.pos, texSize: [AW, AH], bones: null, cell: name === 'backHair' ? 4 : 8, wy }), tex: 'atlas' };
    }
    acv.width = acv.height = 1;
    this.compCanvas = cv; this.compTexSize = [CW, CH];
  }

  // ------------------------------------------------------------ WebGL
  initGL(atlas) {
    // no preserveDrawingBuffer: it costs a buffer copy per frame; offline readers call toDataURL in the same task as draw
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, antialias: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pg = gl.createProgram(); gl.attachShader(pg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pg); gl.useProgram(pg);
    const U = (n) => gl.getUniformLocation(pg, n);
    this.loc = { pos: gl.getAttribLocation(pg, 'aPos'), uv: gl.getAttribLocation(pg, 'aUv'), w: gl.getAttribLocation(pg, 'aW'), t: gl.getAttribLocation(pg, 'aT'), M: U('uM'), view: U('uView'), tex: U('uTex'), alpha: U('uAlpha'), sharp: U('uSharp'), sway: U('uSway'), box: U('uBox'), warp: U('uWarp'), turn: U('uTurn'), sig: U('uSig'), chin: U('uChin') };
    this.prog = pg;
    // seam-fill pass: the parts are drawn into an offscreen texture, then copied to the canvas through FILL_FS
    {
      const fp = gl.createProgram(); gl.attachShader(fp, sh(gl.VERTEX_SHADER, QUAD_VS)); gl.attachShader(fp, sh(gl.FRAGMENT_SHADER, FILL_FS)); gl.linkProgram(fp);
      const W = this.canvas.width, H = this.canvas.height;
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      this.fill = { prog: fp, tex: t, fb, quad: q, aQ: gl.getAttribLocation(fp, 'aQ'), src: gl.getUniformLocation(fp, 'uSrc'), px: gl.getUniformLocation(fp, 'uPx'), r: gl.getUniformLocation(fp, 'uR'), r0: gl.getUniformLocation(fp, 'uR0') };
      gl.useProgram(fp); gl.uniform1i(this.fill.src, 0); gl.uniform2f(this.fill.px, 1 / W, 1 / H); gl.uniform1f(this.fill.r, Math.ceil(FILL_R * this.scale)); gl.uniform1f(this.fill.r0, Math.ceil(FILL_R0 * this.scale));
      gl.useProgram(pg);
    }
    const tex = (src) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    this.tex = { atlas: tex(atlas), comp: tex(this.compCanvas) };
    if (this.idAtlas) this.tex.id = tex(this.idAtlas);
    this.compCanvas.width = this.compCanvas.height = 1;   // the GPU copy is all we keep
    const buf = (data, target = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    for (const m of Object.values(this.meshes)) m.gl = { pos: buf(m.pos), uv: buf(m.uv), wt: buf(m.wt), wtT: buf(m.wtT), idx: buf(m.idx, gl.ELEMENT_ARRAY_BUFFER), n: m.idx.length };
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.loc.view, this.rig.frame.w, this.rig.frame.h);
    gl.uniform1i(this.loc.tex, 0);
    for (const k of ['pos', 'uv', 'w', 't']) gl.enableVertexAttribArray(this.loc[k]);
  }
  /** items: [{ z, mesh, mats: [m0, m1?, m2?], alpha?, sway?: [x, y0, depth], box?, turn?: [yaw, pitch] rad, warp? }] */
  /** id: false (colour), or the offline ID pass: 'all' (head and every left-arm drawing) or a number k (the head
   * and only the k-th left-arm drawing drawn this frame, so two drawings can be told apart). */
  paint(items, id = false) {
    const gl = this.gl, L = this.loc, isId = id !== false;
    const post = !isId && !this.noFill;
    gl.useProgram(this.prog);
    for (const k of ['pos', 'uv', 'w', 't']) gl.enableVertexAttribArray(this.loc[k]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? this.fill.fb : null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, isId ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(L.sharp, isId ? 1 : Math.max(1, this.scale / 2));
    // offline ID pass: the head and left-arm meshes drawn additively from the ID atlas (R lens
    // rims, G irises, B left-arm coverage), alpha left at 1
    if (isId) {
      let k = -1;
      items = items.filter((it) => it.head || (it.arm && (id === 'all' || ++k === id)));
      gl.blendFunc(gl.ONE, gl.ONE); gl.colorMask(true, true, true, false);
    }
    const attr = (b, loc, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
    const u = new Float32Array(24);
    // stable sort: equal z keeps push order (cross-fades push the earlier key first)
    items = items.map((it, i) => [it, i]).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]).map(([it]) => it);
    const W = this.rig.head.warp;
    for (const it of items) {
      if ((it.alpha ?? 1) <= 0) continue;
      const m = this.meshes[it.mesh];
      gl.bindTexture(gl.TEXTURE_2D, this.tex[isId ? 'id' : m.tex]);
      attr(m.gl.pos, L.pos, 2); attr(m.gl.uv, L.uv, 2); attr(m.gl.wt, L.w, 3); attr(m.gl.wtT, L.t, 1);
      for (let i = 0; i < 4; i++) { const mm = (i === 3 ? it.tm : it.mats[i]) ?? it.mats[0]; u.set([mm[0], mm[2], mm[4], mm[1], mm[3], mm[5]], i * 6); }
      gl.uniform3fv(L.M, u);
      gl.uniform1f(L.alpha, it.alpha ?? 1);
      gl.uniform3fv(L.sway, it.sway ?? [0, 0, 1]);
      gl.uniform4fv(L.box, it.box ?? NO_BOX);
      const wr = it.warp ?? W;
      gl.uniform4f(L.warp, wr.cx, wr.cy, wr.R, wr.Rv);
      gl.uniform2f(L.sig, wr.sx, wr.sy);
      gl.uniform2f(L.chin, wr.chinY ?? 1e4, wr.chinW ?? 1);
      gl.uniform2fv(L.turn, it.turn ?? [0, 0]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.gl.idx); gl.drawElements(gl.TRIANGLES, m.gl.n, gl.UNSIGNED_SHORT, 0);
    }
    if (isId) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.colorMask(true, true, true, true); }
    if (post) {
      const F = this.fill;
      for (const k of ['pos', 'uv', 'w', 't']) gl.disableVertexAttribArray(this.loc[k]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(F.prog); gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, F.tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, F.quad); gl.enableVertexAttribArray(F.aQ); gl.vertexAttribPointer(F.aQ, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(F.aQ); gl.enable(gl.BLEND);
    }
  }

  /** The spec's 2D state in app px (y down), plus joint rolls. */
  specState(P) {
    const F = this.spec.frame, L = layerState(P, this.yaw), W = L.W;
    const px = (p) => { const q = project(p, this.yaw); return [F.originXPx + q[0] * F.pxPerM, F.originYPx - q[1] * F.pxPerM]; };
    const sg = {};
    for (const [n, v] of Object.entries(L.limbs)) sg[n] = { angle: -v.angle, ratio: v.ratio };
    const roll = {};
    for (const j of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head']) roll[j] = rollOf(W, j, this.yaw);
    const pos = {};
    for (const j of ['hips', 'upperChest', 'leftUpperArm', 'rightUpperArm', 'leftFoot', 'rightFoot']) pos[j] = px(W[j].p);
    return { seg: sg, roll, pos, turns: L.turns, W };
  }

  /** Secondary motion: a damped spring per part on a tracked point; returns the lag (px, 1x) clamped. */
  spring(name, x, cfg, t) {
    let s = this.springs[name];
    if (!s) s = this.springs[name] = { x, v: 0 };
    s.target = x;
    const dt = this.lastT === null || t === undefined ? 0 : clamp((t - this.lastT) / 1000, 0, 0.1);
    for (let i = 0, n = Math.ceil(dt / 0.004); i < n; i++) {
      const h = dt / n, a = cfg.k * (x - s.x) - cfg.damp * s.v;
      s.v += a * h; s.x += s.v * h;
    }
    // settled: snap, so a held frame is exactly the rest frame
    if (Math.abs(s.x - x) < 0.01 && Math.abs(s.v) < 0.05) { s.x = x; s.v = 0; }
    return clamp((s.x - x) * cfg.gain, -cfg.maxPx, cfg.maxPx);
  }

  /**
   * Builds the draw list of one composed pose. opts: { planted = true, clip = 'idle', now (ms, for springs) }.
   * Returns { items, joints (posed, 1x frame px), headView, pair, sig } where sig is what a viewer can see change.
   */
  build(P, opts = {}) {
    const rig = this.rig, J = rig.joints, Lt = this.specState(P), L0 = this.L0, k = rig.kArt;
    const planted = opts.planted ?? true, clip = opts.clip ?? 'idle';
    const st = this.stats;
    const dRoll = (j) => angDiff(Lt.roll[j], L0.roll[j]);
    const dH = scl2(sub2(Lt.pos.hips, L0.pos.hips), k);
    const Tp = about(J.hips, dRoll('hips'), add2(J.hips, dH));
    const waist = ap(Tp, J.waist);
    const Tt = about(J.waist, dRoll('upperChest'), waist);
    const neck = ap(Tt, J.neck);
    const Tn = about(J.neck, dRoll('neck'), neck);
    const headP = ap(Tn, J.head);
    const Th = about(J.head, dRoll('head'), headP);
    const ucT = about(L0.pos.upperChest, dRoll('upperChest'), Lt.pos.upperChest);
    const shoulder = (side) => add2(ap(Tt, J[`${side}Shoulder`]), scl2(sub2(Lt.pos[`${side}UpperArm`], ap(ucT, L0.pos[`${side}UpperArm`])), k));
    const items = [], posed = {}, sig = [];
    const clampS = (name, s, min = rig.stretch.min) => {
      const c = clamp(s, min, rig.stretch.max);
      if (c !== s) st.clamped[name] = (st.clamped[name] ?? 0) + 1;
      st.maxStretchDev[name] = Math.max(st.maxStretchDev[name] ?? 0, Math.abs(c - 1));
      return c;
    };
    /** Poses a chain: bones [[from, angle, len]] -> matrices and joint ends. */
    const chainMats = (name, specs) => {
      const c = this.chains[name], mats = [], ends = [];
      specs.forEach(([from, angle, len], i) => {
        const key = c.bones[i], L = len;
        const P0 = from ?? ends[i - 1];
        mats.push(boneMatrix(key, P0, angle, L));
        ends.push(add2(P0, scl2(dirOf(angle), L)));
      });
      return { mats, ends };
    };
    const segDelta = (n) => ({ dA: angDiff(Lt.seg[n].angle, L0.seg[n].angle), r: Lt.seg[n].ratio / L0.seg[n].ratio });

    // ---- right arm: one whole-arm drawing, skinned
    {
      const S0 = shoulder('right'), c = this.chains['rightArm.rest'];
      const b = ['rightUpperArm', 'rightForearm', 'rightHand'].map((n, i) => { const d = segDelta(n), kb = c.bones[i]; return [i ? null : S0, kb.angle + d.dA, kb.len * clampS(`rightArm.${i}`, d.r)]; });
      const { mats, ends } = chainMats('rightArm.rest', b);
      items.push({ z: c.z, mesh: 'rightArm.rest', mats });
      posed.rightUpperArm = [S0, ends[0]]; posed.rightForearm = [ends[0], ends[1]]; posed.rightHand = [ends[1], ends[2]];
    }
    // ---- left arm: key-pose drawings, blended offsets, the two heaviest cross-faded on the same bones
    {
      // a section may name its own drawings (clipKeys['drag.enter']: the landing drawing has no place in the lift)
      const A = rig.leftArm, keys = A.clipKeys[`${clip}.${opts.part}`] ?? A.clipKeys[clip] ?? ['rest'];
      const cur = { upper: Lt.seg.leftUpperArm, forearm: Lt.seg.leftForearm, hand: Lt.seg.leftHand };
      const raw = keys.map((key) => {
        const sp = A.keys[key].spec;
        const d = Math.abs(angDiff(cur.upper.angle, sp.leftUpperArm.angle)) + Math.abs(angDiff(cur.forearm.angle, sp.leftForearm.angle)) + 0.5 * Math.abs(angDiff(cur.hand.angle, sp.leftHand.angle))
          + 60 * Math.abs(cur.forearm.ratio - sp.leftForearm.ratio);
        return d;
      });
      // Shepard interpolation: at a key's anchor its weight is exactly 1, so a clip that starts or ends on the
      // rest pose draws the rest frame exactly (the soft weights left a sub-pixel offset)
      const hit = raw.findIndex((d) => d < 1e-6);
      const inv = raw.map((d, i) => (hit >= 0 ? (i === hit ? 1 : 0) : 1 / d ** A.weightPower));
      const wsum = inv.reduce((a, b) => a + b, 0), ws = inv.map((w) => w / wsum);
      const off = { upper: 0, forearm: 0, hand: 0, lu: 0, lf: 0, lh: 0 };
      keys.forEach((key, i) => {
        const w = ws[i], pr = A.keys[key], sp = pr.spec, ar = pr.art;
        off.upper += w * angDiff(ar.upper.angle, sp.leftUpperArm.angle);
        off.forearm += w * angDiff(ar.forearm.angle, sp.leftForearm.angle);
        off.hand += w * angDiff(ar.hand.angle, sp.leftHand.angle);
        off.lu += w * Math.log(ar.upper.len / sp.leftUpperArm.ratio);
        off.lf += w * Math.log(ar.forearm.len / sp.leftForearm.ratio);
        off.lh += w * Math.log(ar.hand.len / sp.leftHand.ratio);
      });
      const S0 = shoulder('left');
      const raw3 = [[cur.upper.angle + off.upper, Math.exp(off.lu) * cur.upper.ratio], [cur.forearm.angle + off.forearm, Math.exp(off.lf) * cur.forearm.ratio], [cur.hand.angle + off.hand, Math.exp(off.lh) * cur.hand.ratio]];
      // the projected 2D angle of a bone sweeps fast where the bone passes end-on, and the art offsets switch
      // from one key to the next within a frame or two near the midpoint between anchors: the posed arm jumped
      // 15-25 app px in one frame. The posed angles and lengths follow those targets through a critically damped
      // filter (settles in about 3 frames)
      const bones = [[S0, raw3[0][0], raw3[0][1]], [null, raw3[1][0], raw3[1][1]], [null, raw3[2][0], raw3[2][1]]];
      // the drawing shown is the one the pose bends least (elbow and wrist bend change from the drawing's own
      // configuration, plus a quarter of the upper-arm turn), with 8 deg hysteresis; when it changes, the old and the new drawing are
      // cross-faded over fadeMs on the same posed bones: the old one first and opaque until halfway, the new one
      // over it (alpha min(1, 2u)), so one of them is always opaque and no frame swaps a drawing at once
      const bendOf = (key) => {
        const ar = A.keys[key].art;
        const dU = angDiff(bones[0][1], ar.upper.angle), dE = angDiff(bones[1][1] - bones[0][1], ar.forearm.angle - ar.upper.angle), dW = angDiff(bones[2][1] - bones[1][1], ar.hand.angle - ar.forearm.angle);
        // turning the whole arm about the shoulder is rigid (free); bending a joint away from the drawing deforms it
        // upperCost: an in-between drawing whose sleeve lies over the shirt shows its cut inner edge when turned
        // about the shoulder (the front drawing turned out toward the hip read as a broken upper arm)
        return { dU, dE, dW, cost: (A.keys[key].upperCost ?? 0.25) * Math.abs(dU) + Math.abs(dE) + 0.5 * Math.abs(dW) };
      };
      // a drawing's cost is scaled by its costScale: the hip drawing gives way to the hanging one as soon as the
      // hand leaves the hip (the rest drawing straightened in the air kinks at the elbow)
      // A.choose 'spec' picks the drawing whose anchor pose is nearest the spec arm (the Shepard distance above),
      // so an in-between drawing is shown only around the stretch of the clip it was drawn for; by bend cost the
      // tuckmid drawing won near the hip on the way down (all drawings were far by then)
      const costs = A.choose === 'spec' ? raw.map((d, i) => d * (A.keys[keys[i]].costScale ?? 1)) : keys.map((k) => bendOf(k).cost * (A.keys[k].costScale ?? 1));
      let ti = costs.indexOf(Math.min(...costs));
      const F = this.armFade, now = opts.now;
      const live = F && keys.includes(F.from) && keys.includes(F.to);
      if (live && costs[keys.indexOf(F.to)] <= costs[ti] + A.hysteresisDeg) ti = keys.indexOf(F.to);
      const target = keys[ti];
      this.debugArm = { keys, costs: costs.map((c) => +c.toFixed(1)), bones: bones.map((b) => [+b[1].toFixed(1), +b[2].toFixed(2)]), ti };
      // the drawing changes at once: a cross-fade between two drawings shows two arms
      let drawn, f = 1;
      if (!live || now === undefined) { this.armFade = { from: target, to: target, since: now ?? 0 }; drawn = [[ti, 1]]; }
      else if (!this.xfade) { if (target !== F.to) { this.armFade = { from: F.to, to: target, since: now }; st.swaps = (st.swaps ?? 0) + 1; } drawn = [[ti, 1]]; }
      else {
        // offline checks only (xfade): the cross-fade the doubled-limb rule must catch
        if (target !== F.to) { const u0 = smooth((now - F.since) / A.fadeMs); this.armFade = { from: u0 < 0.5 ? F.from : F.to, to: target, since: now }; }
        const G = this.armFade;
        f = G.from === G.to ? 1 : smooth((now - G.since) / A.fadeMs);
        drawn = G.from === G.to ? [[keys.indexOf(G.to), 1]]
          : [[keys.indexOf(G.from), Math.min(1, 2 * (1 - f))], [keys.indexOf(G.to), Math.min(1, 2 * f)]].filter(([, alpha]) => alpha > 0);
      }
      const poseAll = (bs) => drawn.map(([i, alpha]) => {
        const pr = A.keys[keys[i]], c = this.chains[pr.chain];
        // each drawing keeps its own bone lengths: the stretch is the posed length over that drawing's length;
        // the forearm may shorten to minLeftArm[1] where it points at the camera (a raise passes end-on)
        // linear-blend skinning folds a joint bent far from its drawing: a drawing bends at most maxBend from its
        // own elbow and wrist angles (the cross-fade to the next drawing covers the rest of the way)
        // a drawing folded in the art (forearm painted over the upper arm) has its own, smaller limit: its texels
        // near the fold belong to both bones and tear into streaks when it bends
        const ar = pr.art, mb = pr.maxBendDeg ?? A.maxBendDeg;
        const relE = ar.forearm.angle - ar.upper.angle, relW = ar.hand.angle - ar.forearm.angle;
        // the elbow bends at most mb[0] either way from the drawing, and never past straight (no hyperextension)
        let dE = clamp(angDiff(bs[1][1] - bs[0][1], relE), -mb[0], mb[0]);
        // a bent drawing may straighten but not bend through straight the other way (2D bend sides differ by
        // pose: the hip arm bends clockwise on screen, the raised arm counter-clockwise)
        const relEn = angDiff(relE, 0), sgn = Math.abs(relEn) > 10 ? Math.sign(relEn) : 0;
        if (sgn && sgn * (relEn + dE) < -3) dE = -3 * sgn - relEn;   // relEn + dE is unwrapped: a fold past 180 is not straight
        // upperOffsetDeg: a drawing that hangs a hair off the body (talk: a 1 px slit beside the waist) is turned in
        const aU = bs[0][1] + (pr.upperOffsetDeg ?? 0), aF = aU + relE + dE, aH = aF + relW + clamp(angDiff(bs[2][1] - bs[1][1], relW), -mb[1], mb[1]);
        const angs = [aU, aF, aH];
        const lens = bs.map(([, , len], b) => c.bones[b].len * clampS(`${pr.chain}.${b}`, len / pr.art[['upper', 'forearm', 'hand'][b]].len, rig.stretch.minLeftArm[b]));
        const r = chainMats(pr.chain, bs.map(([from], b) => [from, angs[b], lens[b]]));
        return { pr, c, alpha, angs, lens, from: bs[0][0], ...r };
      });
      // keep the hand inside the frame: if any drawn vertex comes within 3 px of the right
      // edge or the top, turn the forearm and hand about the elbow, the least angle that fits
      const fits = (posed) => posed.every((q) => { const e = this.extent(q.pr.chain, q.mats, Tt); return e.maxX <= rig.frame.w - 3 && e.minY >= 3; });
      let posedArm = poseAll(bones);
      if (!fits(posedArm)) {
        const turned = (th) => bones.map((b, i) => (i ? [b[0], b[1] + th, b[2]] : b));
        // upward (counter-clockwise) first: a hand lowered to fit reads as a drooping wrist
        let lo = 0, hi = 0;
        for (const dir of [-1, 1]) { if (hi) break; for (let th = 2; th <= 90; th += 2) if (fits(poseAll(turned(dir * th)))) { hi = dir * th; break; } }
        if (hi) { for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (fits(poseAll(turned(mid)))) hi = mid; else lo = mid; } posedArm = poseAll(turned(hi)); st.keptIn = (st.keptIn ?? 0) + 1; }
      }
      // the shown drawing's final angles and lengths go through the pose filter: where the drawing swaps, or a
      // bend limit starts to hold, the new pose starts from the last one drawn instead of jumping
      if (!this.xfade && posedArm.length === 1) {
        const q = posedArm[0], sm = this.armSmooth(q.angs.map((a, b) => [a, q.lens[b]]), now);
        q.angs = sm.map((x) => x[0]); q.lens = sm.map((x) => x[1]);
        const turnQ = (th) => chainMats(q.pr.chain, q.angs.map((a, b) => [b ? null : q.from, a + (b ? th : 0), q.lens[b]]));
        Object.assign(q, turnQ(0));
        // the filtered pose lags its target: keep it inside the frame too, and carry the turn into the filter state
        // so the next frame starts from what was drawn
        // only toward where the filter is going (the other way fought the filter and wound the forearm round)
        if (!fits([q])) {
          let lo = 0, hi = 0;
          const togo = angDiff(this.armF[1][0].target, this.armF[1][0].x), dir = Math.sign(togo) || -1;
          // 1. a turn within the rate cap; 2. foreshorten the forearm and hand, as the spec does where they point at
          // the camera (the forearm passing level and out: wave 12-13, 66-67); 3. a turn as far as it takes
          const tryTurn = (maxTh) => {
            let lo = 0, hi = 0;
            for (let th = 2; th <= Math.max(2, maxTh); th += 2) if (fits([{ ...q, ...turnQ(dir * th) }])) { hi = dir * th; break; }
            if (!hi) return false;
            for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (fits([{ ...q, ...turnQ(mid) }])) hi = mid; else lo = mid; }
            Object.assign(q, turnQ(hi)); this.armF[1][0].x += hi; this.armF[2][0].x += hi; return true;
          };
          const shorten = () => {
            for (let k = 0.95; k >= 0.5; k -= 0.05) {
              const L2 = q.lens.map((l, b) => (b ? l * k : l));
              const m = chainMats(q.pr.chain, q.angs.map((a, b) => [b ? null : q.from, a, L2[b]]));
              if (fits([{ ...q, ...m }])) { Object.assign(q, m); q.lens = L2; this.armF[1][1].x = L2[1]; this.armF[2][1].x = L2[2]; return true; }
            }
            return false;
          };
          if (tryTurn(Math.min(Math.abs(togo), ARM_MAX_DEG_S / 30)) || shorten() || tryTurn(Math.abs(togo))) st.keptIn = (st.keptIn ?? 0) + 1;
        }
      }
      let ends = null;
      for (const q of posedArm) {
        items.push({ z: q.c.z, mesh: q.pr.chain, mats: q.mats, tm: Tt, alpha: q.alpha, arm: true });
        if (!ends || q.alpha === 1) ends = q.ends;
        sig.push(`${q.pr.chain}:${q.alpha.toFixed(2)}`);
      }
      if (f > 0 && f < 1) st.fades++;
      this.debugArm.fade = f > 0 && f < 1;
      const best = target;
      st.pair[best] = (st.pair[best] ?? 0) + 1;
      posed.leftUpperArm = [S0, ends[0]]; posed.leftForearm = [ends[0], ends[1]]; posed.leftHand = [ends[1], ends[2]];
      this.lastPair = best;
    }
    // ---- legs
    for (const side of ['left', 'right']) {
      const name = `${side}Leg`, hip = ap(Tp, J[`${side}Hip`]), c = this.chains[name];
      const [kT, kS, kF] = c.bones;
      const dT = segDelta(`${side}Thigh`), dS = segDelta(`${side}Shin`), dF = segDelta(`${side}Shoe`);
      let aT = kT.angle + dT.dA, lT = kT.len * clamp(dT.r, rig.stretch.min, rig.stretch.max);
      let aS = kS.angle + dS.dA, lS = kS.len * clamp(dS.r, rig.stretch.min, rig.stretch.max);
      const ankle0 = add2(add2(hip, scl2(dirOf(aT), lT)), scl2(dirOf(aS), lS));
      // The foot is seen nearly end-on (projected ratio ~0.3-0.5), so a small pitch swings its 2D angle a lot:
      // the shoe follows the shin, plus at most +/-8 deg of its own ankle play.
      let aF = kF.angle + dS.dA + clamp(angDiff(dF.dA, dS.dA), -8, 8), lF = kF.len * clamp(dF.r, 0.9, 1.1);
      if (planted) {
        // pin the ankle: turn and scale the hip->ankle chain about the hip to meet the rest ankle
        const target = J[`${side}Ankle`], v0 = sub2(ankle0, hip), v1 = sub2(target, hip);
        const turn = angDiff(Math.atan2(v1[1], v1[0]) / D2R, Math.atan2(v0[1], v0[0]) / D2R), sc = Math.hypot(...v1) / Math.hypot(...v0);
        aT += turn; aS += turn; lT *= sc; lS *= sc;
        aF = kF.angle; lF = kF.len;
      }
      const { mats, ends } = chainMats(name, [[hip, aT, lT], [null, aS, lS], [planted ? J[`${side}Ankle`] : null, aF, lF]]);
      items.push({ z: c.z, mesh: name, mats });
      posed[`${side}Thigh`] = [hip, ends[0]]; posed[`${side}Shin`] = [ends[0], ends[1]]; posed[`${side}Shoe`] = [ends[1], ends[2]];
    }
    // ---- rigid groups with secondary motion
    const sec = rig.secondary, now = opts.now;
    const sway = (name, M, part) => {
      const cfg = sec[name];
      const tip = ap(M, [J.head[0], cfg.anchorY + cfg.depth]);   // tracked point: where the part hangs to
      const lag = this.spring(name, tip[0], cfg, now);
      return { sway: [lag, cfg.anchorY, cfg.depth], box: cfg.box ?? NO_BOX, part };
    };
    const pel = sway('pelvis', Tp);
    items.push({ z: rig.parts.pelvis.z, mesh: 'pelvis', mats: [Tp], sway: pel.sway });
    const bow = sway('bow', Tt);
    items.push({ z: rig.parts['torso.noLeftSleeve'].z, mesh: 'torso.noLeftSleeve', mats: [Tt], sway: bow.sway, box: bow.box });
    items.push({ z: rig.parts.neck.z, mesh: 'neck', mats: [Tn] });
    // ---- head: one drawing (back hair, head, front hair, face swaps), warped by the turn. No whole-head
    // cross-fades (two half-transparent faces) and no turned drawings (their necks and ponytails do not join):
    // the features, the glasses baked on them included, move with the face by the same warp.
    // The turn is compressed to +/-maxTurnDeg (a 2D warp past that slides the features off the face).
    const ex = P.expr ?? {};
    const H = rig.head, dy = Lt.turns.head.yaw - L0.turns.head.yaw, dp = Lt.turns.head.pitch - L0.turns.head.pitch;
    const soft = (x, m) => m * Math.tanh(x / m);
    const turnF = [soft(dy, H.maxTurnDeg[0]) * D2R, soft(dp, H.maxTurnDeg[1]) * D2R];
    const warp = H.warp;
    const blinkOn = (ex.blink ?? 0) >= rig.face.eyesClosed.min;
    const hairF = sway('frontHair', Th), hairB = sway('backHair', Th);
    const headItems = (turn, alpha) => {
      const o = [];
      o.push({ z: rig.parts.backHair.z, mesh: 'backHair', mats: [Th, Tt], sway: hairB.sway, turn, warp, alpha });
      o.push({ z: 16, mesh: blinkOn ? H.front.closed : 'head', mats: [Th], turn, warp, alpha, head: true });
      o.push({ z: rig.parts.frontHair.z, mesh: 'frontHair', mats: [Th], sway: hairF.sway, turn, warp, alpha });
      if (!blinkOn) {
        if (Math.max(0, ...VISEMES.map((v) => ex[v] ?? 0)) >= rig.face.talk.min) o.push({ z: 18, mesh: rig.face.talk.part, mats: [Th], turn, warp, alpha });
        else if ((ex.happy ?? 0) >= rig.face.smile.min) o.push({ z: 18, mesh: rig.face.smile.part, mats: [Th], turn, warp, alpha });
      }
      return o;
    };
    // offline checks only (xfade): a whole-head cross-fade, the unturned head under the turned one at half alpha
    if (this.xfade && Math.abs(dy) > 3) items.push(...headItems([0, 0], 1).map((it) => ({ ...it, z: it.z - 0.01 })));
    items.push(...headItems(turnF, this.xfade && Math.abs(dy) > 3 ? 0.5 : 1));
    sig.push(`f${blinkOn ? 'c' : 'o'}${items.filter((it) => it.z === 18).map((it) => it.mesh).join('')}`);
    // what a viewer can see change: posed joints, head transform and turn, springs, and the discrete swaps
    const nums = [];
    for (const v of Object.values(posed)) nums.push(v[0][0], v[0][1], v[1][0], v[1][1]);
    nums.push(...ap(Th, [J.head[0], J.head[1] - 50]), ...ap(Tp, [J.hips[0], J.hips[1] + 40]), turnF[0] / D2R * 0.5, turnF[1] / D2R * 0.5, pel.sway[0], bow.sway[0], hairF.sway[0], hairB.sway[0]);
    if (now !== undefined) this.lastT = now;
    st.frames++;
    return { items, joints: posed, headView: 'head', headTurn: [+(turnF[0] / D2R).toFixed(2), +(turnF[1] / D2R).toFixed(2)], headCentre: ap(Th, [rig.head.warp.cx, rig.head.warp.cy]), pair: this.lastPair, sig: { nums, keys: sig.join('|') } };
  }
  /** Bounding extent (1x frame px) of a skinned chain mesh under its bone matrices. */
  extent(name, mats, tm) {
    const m = this.meshes[name], P = m.pos, Wt = m.wt, WT = m.wtT;
    let maxX = -Infinity, minY = Infinity;
    for (let v = 0; v < P.length / 2; v++) {
      let x = 0, y = 0;
      for (let b = 0; b < 3; b++) { const w = Wt[v * 3 + b]; if (!w) continue; const M = mats[b]; x += w * (M[0] * P[2 * v] + M[2] * P[2 * v + 1] + M[4]); y += w * (M[1] * P[2 * v] + M[3] * P[2 * v + 1] + M[5]); }
      if (tm && WT[v]) { const t = WT[v]; x = (1 - t) * x + t * (tm[0] * P[2 * v] + tm[2] * P[2 * v + 1] + tm[4]); y = (1 - t) * y + t * (tm[1] * P[2 * v] + tm[3] * P[2 * v + 1] + tm[5]); }
      if (x > maxX) maxX = x; if (y < minY) minY = y;
    }
    return { maxX, minY };
  }
  /**
   * Offline checks only: how far each skinned limb mesh is from a rigid copy of its drawing, per triangle
   * (a sleeve sheared into a spike and a forearm folded over the upper arm show as a cut line). The posed triangle's affine map from texture px (2x) to frame px (1x) has singular values s1 >= s2;
   * a rigid or evenly stretched piece has s1/s2 near 1. Returns, over the skinned meshes drawn: foldPx, the posed
   * area (1x px^2) of triangles turned over (a fold); shearPx, the posed area of triangles with s1/s2 > 2.2 (a
   * shear or a crush); and maxAniso.
   */
  meshQuality(items) {
    let foldPx = 0, shearPx = 0, maxAniso = 1;
    for (const it of items) {
      if (!it.mats || it.mats.length < 3) continue;
      const m = this.meshes[it.mesh], P = m.pos, Wt = m.wt, WT = m.wtT, I = m.idx, tm = it.tm;
      const n = P.length / 2, q = new Float32Array(2 * n);
      for (let v = 0; v < n; v++) {
        let x = 0, y = 0;
        for (let b = 0; b < 3; b++) { const w = Wt[v * 3 + b]; if (!w) continue; const M = it.mats[b]; x += w * (M[0] * P[2 * v] + M[2] * P[2 * v + 1] + M[4]); y += w * (M[1] * P[2 * v] + M[3] * P[2 * v + 1] + M[5]); }
        if (tm && WT[v]) { const t = WT[v]; x = (1 - t) * x + t * (tm[0] * P[2 * v] + tm[2] * P[2 * v + 1] + tm[4]); y = (1 - t) * y + t * (tm[1] * P[2 * v] + tm[3] * P[2 * v + 1] + tm[5]); }
        q[2 * v] = x; q[2 * v + 1] = y;
      }
      for (let t = 0; t < I.length; t += 3) {
        const [i0, i1, i2] = [I[t], I[t + 1], I[t + 2]];
        // rest (texture) edges and posed edges
        const ax = P[2 * i1] - P[2 * i0], ay = P[2 * i1 + 1] - P[2 * i0 + 1], bx = P[2 * i2] - P[2 * i0], by = P[2 * i2 + 1] - P[2 * i0 + 1];
        const cx = q[2 * i1] - q[2 * i0], cy = q[2 * i1 + 1] - q[2 * i0 + 1], dx = q[2 * i2] - q[2 * i0], dy = q[2 * i2 + 1] - q[2 * i0 + 1];
        const det0 = ax * by - ay * bx;
        if (Math.abs(det0) < 1e-6) continue;
        // J = [c d] [a b]^-1
        const j00 = (cx * by - dx * ay) / det0, j01 = (dx * ax - cx * bx) / det0, j10 = (cy * by - dy * ay) / det0, j11 = (dy * ax - cy * bx) / det0;
        const det = j00 * j11 - j01 * j10, area = Math.abs(cx * dy - cy * dx) / 2;
        if (det <= 0) { foldPx += area; continue; }
        const fro = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11, disc = Math.sqrt(Math.max(0, fro * fro / 4 - det * det));
        const s1 = Math.sqrt(fro / 2 + disc), s2 = Math.sqrt(Math.max(1e-12, fro / 2 - disc));
        const an = s1 / s2;
        if (an > maxAniso) maxAniso = an;
        if (an > 2.2) shearPx += area;
      }
    }
    return { foldPx: Math.round(foldPx * 10) / 10, shearPx: Math.round(shearPx * 10) / 10, maxAniso: Math.round(maxAniso * 100) / 100 };
  }
  /** Builds and paints one pose. */
  draw(P, opts = {}) { const b = this.build(P, opts); this.paint(b.items); return b; }

  /** Offline: pose of one section at local time t (idle phase idleT), drawn. Frames of a clip come in order. */
  drawSection(s, t, idleT = 0) {
    const P = composite(this.spec, s, t, idleT, true);
    const air = s.parent.airborne && (s.part !== 'exit' || t < (s.clip.groundContactAt ?? Infinity));
    return this.draw(P, { planted: !air, clip: s.name, part: s.part, now: t });
  }
  drawRest() { this.resetMotion(); return this.draw(this.restP, { planted: true, clip: 'idle' }); }
}

// ---------------------------------------------------------------- live: scheduler timeline + draw loop
/** Online wrapper around the reference scheduler: keeps the event log, re-simulates when it changes. */
export class Timeline {
  constructor(spec, { seed = 1 } = {}) {
    this.spec = spec; this.events = []; this.segs = []; this.seed = seed; this.dirty = true;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.blinks = []; this.nextBlink = 0;
    // the app's idle ticks (idleTick.intervalMs): pre-rolled, re-armed by the scheduler's own rules
    for (const t of idleTickTimes(spec, 3600000, seed)) this.events.push([t, 'idleTick']);
  }
  emit(t, name, data) { this.events.push(data ? [t, name, data] : [t, name]); this.dirty = true; }
  segsAt(t) {
    if (this.dirty) { this.segs = simulate(this.spec, this.events.slice().sort((a, b) => a[0] - b[0]), { untilMs: t + 600000, seed: this.seed }); this.dirty = false; }
    return this.segs;
  }
  /** Procedural blink (idle.events.blink): every 2-6 s, sometimes double. Returns the blink weight. */
  blinkAt(t) {
    this.rollBlinks(t);
    let w = 0;
    const clip = this.spec.clips[this.spec.idle.events.blink.clip];
    for (const s of this.blinks) if (t >= s && t < s + 260) w = Math.max(w, sampleTrack(clip.expressions.blink, t - s));
    return w;
  }
  rollBlinks(t) {
    const b = this.spec.idle.events.blink;
    while (this.nextBlink <= t + 10000) {
      this.nextBlink += b.intervalMs[0] + this.rng() * (b.intervalMs[1] - b.intervalMs[0]);
      this.blinks.push(this.nextBlink);
      if (this.rng() < b.doubleChance) this.blinks.push(this.nextBlink + b.doubleGapMs);
    }
    while (this.blinks.length && this.blinks[0] < t - 1000) this.blinks.shift();
  }
  /** Is anything moving at t (a clip, an overlay, a blink or an idle event)? If not, when does the next start? */
  activity(t) {
    const segs = this.segsAt(t);
    const cur = segs.find((s) => s.start <= t && s.end > t);
    if (cur) return { busy: true, sleepLoop: cur.clip === 'sleep' && cur.part === 'loop' && !segs.some((s) => s.part === 'overlay' && s.start <= t && s.end > t) };
    this.rollBlinks(t);
    if (this.blinks.some((s) => t >= s && t < s + 300)) return { busy: true };
    if (activeIdleEvents(this.spec.idle, t).length) return { busy: true, slow: true };
    const sc = this.spec.idle.schedule, cyc = Math.floor(t / sc.cycleMs) * sc.cycleMs;
    let next = Infinity;
    for (const s of segs) if (s.start > t) next = Math.min(next, s.start);
    for (const s of this.blinks) if (s > t) next = Math.min(next, s);
    for (const ev of sc.events) for (const c of [cyc, cyc + sc.cycleMs]) if (c + ev.at > t) next = Math.min(next, c + ev.at);
    return { busy: false, next };
  }
  /** Composed pose at absolute time t: body clip (with crossfade on preempt), overlays, blink, mouth. */
  poseAt(player, t) {
    const spec = this.spec, segs = this.segsAt(t);
    const body = segs.filter((s) => s.part !== 'overlay');
    const i = body.findIndex((s) => s.start <= t && s.end > t);
    let P, sec = null, info = { clip: 'idle', planted: true, part: null };
    const poseOf = (sg, tt) => {
      const s = player.section(sg.clip, sg.part);
      return { P: composite(spec, s, tt - sg.start, sg.start, true), s, tl: tt - sg.start };
    };
    if (i < 0) P = idleOnly(spec, t);
    else {
      const sg = body[i], cur = poseOf(sg, t);
      P = cur.P; sec = cur.s;
      info = { clip: sg.clip, part: sg.part, planted: !(sec.parent.airborne && (sec.part !== 'exit' || cur.tl < (sec.clip.groundContactAt ?? Infinity))) };
      const prev = body[i - 1];
      const ev = spec.stateMachine;
      const blendMs = prev && prev.end === sg.start && (prev.how === 'preempted' || (prev.how === 'released' && prev.part === 'loop'))
        ? (prev.how === 'preempted' ? ev.events[Object.keys(ev.events).find((k) => ev.events[k].clip === sg.clip)]?.interruptExitMs ?? 250 : ev.interrupt.exit.blendMs) : 0;
      if (blendMs && t - sg.start < blendMs) {
        const from = poseOf(prev, prev.end).P, u = smooth((t - sg.start) / blendMs);
        const mixed = { ...P, pose: {}, expr: { ...P.expr } };
        for (const b of Object.keys(P.pose)) mixed.pose[b] = P.pose[b].map((x, j) => from.pose[b][j] + (x - from.pose[b][j]) * u);
        mixed.hipsOffset = P.hipsOffset.map((x, j) => from.hipsOffset[j] + (x - from.hipsOffset[j]) * u);
        P = mixed;
      }
    }
    for (const o of segs.filter((s) => s.part === 'overlay' && s.start <= t && s.end > t)) P = addOverlay(spec, P, o.clip, t - o.start);
    const expr = { ...P.expr };
    if (!(sec?.parent?.eyelidOwner)) expr.blink = Math.max(expr.blink ?? 0, this.blinkAt(t));
    for (const [k, w] of Object.entries(mouthAt(spec, segs, t))) expr[k] = (expr[k] ?? 0) + w;
    return { P: { ...P, expr }, info };
  }
}

/**
 * The pet's draw loop: idle is a held frame plus events.
 *   - Between events nothing runs: no timer ticks and no frame is presented; the loop sleeps until the next
 *     blink, idle event, idle tick or scheduled clip (and wakes at once on emit / setHidden(false)).
 *   - During a clip, overlay or blink it ticks at fps (30), during a slow idle event (breath, weight shift,
 *     glance) at idleEventFps (15), and presents a frame only when what a viewer sees changed: a posed joint
 *     moved >= presentPx device px (0.5, a quarter app px at dpr 2), or a drawing swapped.
 *   - The sleep loop ticks at sleepFps (10). Hidden (document hidden or setHidden(true)): nothing at all.
 * Timer-driven, not requestAnimationFrame: a 60 Hz rAF keeps the browser's frame pipeline busy even on ticks
 * that draw nothing (measured: 12 % of a core asleep at 10 fps with rAF).
 */
export function startLoop(player, timeline, { fps = 30, idleEventFps = 10, sleepFps = 10, presentPx = 0.5, idlePresentPx = 1, now = () => performance.now(), onFrame, onTick } = {}) {
  let timer = 0, hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden', stopped = false, last = null;
  const t0 = now();
  const changed = (sig, px) => {
    if (!last || last.keys !== sig.keys) return true;
    const k = player.scale;
    for (let i = 0; i < sig.nums.length; i++) if (Math.abs(sig.nums[i] - last.nums[i]) * k >= px) return true;
    return false;
  };
  let due = 0;
  const schedule = (at) => { timer = setTimeout(tick, Math.max(0, at - (now() - t0))); };
  const tick = () => {
    timer = 0;
    if (stopped || hidden) return;
    const t = now() - t0, act0 = timeline.activity(t);
    const { P, info } = timeline.poseAt(player, t);
    const b = player.build(P, { planted: info.planted, clip: info.clip, part: info.part, now: t });
    // a clip has ended but the hair, bow or skirt still swings: keep ticking (slowly) until it settles, so the
    // held frame is reached without a snap
    const act = !act0.busy && !player.settled() ? { busy: true, slow: true } : act0;
    onTick?.(t, info);
    // idle events present on a full device px; a quarter px of breath is not worth a frame
    if (changed(b.sig, act.slow ? idlePresentPx : presentPx) || !act.busy) { player.paint(b.items); last = b.sig; onFrame?.(t, info); }
    if (!act.busy) {
      // held: nothing moves until the next event; the last presented frame is the rest frame
      player.resetMotion();
      if (Number.isFinite(act.next)) { due = act.next; schedule(due); }
      return;
    }
    const interval = 1000 / (act.sleepLoop ? sleepFps : act.slow ? idleEventFps : fps);
    // absolute due times: Windows timers fire on ~15.6 ms ticks, so a relative 33 ms delay often becomes 47 ms
    due = Math.max(due + interval, t - interval);
    schedule(due);
  };
  const resume = () => { if (!timer && !stopped && !hidden) { due = now() - t0; timer = setTimeout(tick, 0); } };
  const onVis = () => { hidden = document.visibilityState === 'hidden'; if (hidden && timer) { clearTimeout(timer); timer = 0; } else resume(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  resume();
  return {
    t: () => now() - t0,
    /** An app event arrived (it is already in the timeline): wake the loop now. */
    poke() { if (timer) { clearTimeout(timer); timer = 0; } resume(); },
    setHidden(h) { hidden = h; if (h && timer) { clearTimeout(timer); timer = 0; } else resume(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis); },
  };
}

export { clipDuration };
