// Displacement and specular maps for one glass element, after kube.io "Liquid Glass in the Browser"
// (docs/UI-GLASS.md §1). A ray falling straight onto the bezel refracts once (air n=1 → glass n=1.5)
// and lands on the background displaced toward the element's centre; the map stores that vector per
// pixel, the filter's `scale` restores its size in px. Maps are cached by size, radius and profile.

export type Profile = 'convex' | 'lip';

export interface MapSpec { w: number; h: number; r: number; profile: Profile; bezel: number }
export interface GlassMaps {
  /** PNG data URL, RGBA: R = 128 + x·127, G = 128 + y·127, x and y as fractions of the largest displacement;
   *  B = how strongly the bezel is tinted there (glass.ts), highest at the edge. */
  displacement: string;
  /** PNG data URL: white, alpha = rim brightness toward the light. */
  specular: string;
  /** The filter's `scale`. feDisplacementMap moves by scale × (R/255 − 0.5), so this is about twice the largest
   *  displacement in px; the backdrop then lands where the ray table puts it. */
  scale: number;
}

const N_AIR = 1, N_GLASS = 1.5;
/** Samples per bezel radius: one per 8-bit level of the map. */
const RAYS = 127;
/** Glass height at the end of the bezel, as a fraction of the bezel width. At 0.55 the bend stayed under
 *  4 px and could not be seen on the page; 1.6 bends about 7 px at a 16 px bezel after the slope clamp. */
const HEIGHT = 1.6;
/** Largest drop of displacement per px of distance from the edge (see the clamp in `table`). The hover bend (×1.2)
 *  plus one 8-bit level of rounding between neighbouring pixels must stay under 1 px per px. */
const SLOPE = 0.7;
/** Light from the upper left: −60° from straight up, clockwise positive (UI-GLASS.md §1). */
const LIGHT_DEG = -60;
const LIGHT = { x: Math.sin((LIGHT_DEG * Math.PI) / 180), y: -Math.cos((LIGHT_DEG * Math.PI) / 180) };

/** Glass height y ∈ [0, 1] at x ∈ [0, 1] from the edge (0) to the flat interior (1). */
const convex = (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);
const concave = (x: number) => 1 - convex(x);
const smootherstep = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
const PROFILES: Record<Profile, (x: number) => number> = {
  convex,
  // Raised rim with a shallow dip: a toggle's track. Only here, concave parts push rays outward.
  lip: (x) => { const s = smootherstep(x); return convex(x) * (1 - s) + concave(x) * s; },
};

interface Table { mag: Float32Array; tilt: Float32Array; max: number }
const tables = new Map<string, Table>();

/** One bezel radius: displacement (px, before normalisation) and surface tilt per ray. */
function table(profile: Profile, bezel: number): Table {
  const key = `${profile}:${bezel}`;
  let t = tables.get(key);
  if (t) return t;
  const f = PROFILES[profile];
  const height = bezel * HEIGHT;
  const mag = new Float32Array(RAYS), tilt = new Float32Array(RAYS);
  const delta = 0.001;
  let max = 0;
  for (let i = 0; i < RAYS; i++) {
    const x = i / (RAYS - 1);
    // Normal by finite differences in px/px; the ray hits straight down, so the slope angle is the incidence angle.
    const slope = ((f(Math.min(1, x + delta)) - f(Math.max(0, x - delta))) / (2 * delta)) * (height / bezel);
    const theta1 = Math.atan(slope);
    const theta2 = Math.asin((N_AIR / N_GLASS) * Math.sin(theta1));
    // The bent ray crosses the glass below the surface and lands this far inward (outward where the slope is negative).
    const d = f(x) * height * Math.tan(theta1 - theta2);
    mag[i] = d;
    tilt[i] = Math.abs(Math.sin(theta1));
    max = Math.max(max, Math.abs(d));
  }
  // The sampled position (distance + displacement) must grow monotonically toward the interior: where the
  // bend fell off faster than 1px per px, the backdrop folded into loops. Walking inward, each ray may shed at
  // most SLOPE px of displacement per px of distance.
  // The lip keeps its rim-to-dip drop (a 22px track folds nothing visible); the convex caps are where loops showed.
  const step = bezel / (RAYS - 1);
  if (profile === 'convex') for (let i = RAYS - 2; i >= 0; i--) mag[i] = Math.min(mag[i], mag[i + 1] + SLOPE * step);
  max = 0;
  for (const d of mag) max = Math.max(max, Math.abs(d));
  t = { mag, tilt, max };
  tables.set(key, t);
  return t;
}

const maps = new Map<string, GlassMaps>();
const CACHE_MAX = 96;

export function glassMaps(spec: MapSpec): GlassMaps {
  const w = Math.max(1, Math.round(spec.w)), h = Math.max(1, Math.round(spec.h));
  const r = Math.min(spec.r, w / 2, h / 2);
  const bezel = Math.max(1, Math.min(spec.bezel, w / 2, h / 2));
  const key = `${w}x${h}r${r.toFixed(1)}b${bezel.toFixed(1)}${spec.profile}`;
  const hit = maps.get(key);
  if (hit) return hit;
  if (maps.size >= CACHE_MAX) maps.clear();
  const { D, S, scale } = mapPixels(w, h, r, bezel, spec.profile);
  const out = { displacement: toDataUrl(new ImageData(D, w, h)), specular: toDataUrl(new ImageData(S, w, h)), scale };
  maps.set(key, out);
  return out;
}

/** The RGBA pixels of both maps (no DOM): displacement D and specular S, w×h, plus the filter scale. */
export function mapPixels(w: number, h: number, r: number, bezel: number, profile: Profile) {
  const t = table(profile, bezel);
  const D = new Uint8ClampedArray(w * h * 4), S = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2, cy = h / 2, ix = cx - r, iy = cy - r;
  for (let py = 0; py < h; py++) {
    const y = py + 0.5 - cy, ay = Math.abs(y), qy = ay - iy, sy = y < 0 ? -1 : 1;
    for (let px = 0; px < w; px++) {
      const x = px + 0.5 - cx, ax = Math.abs(x), qx = ax - ix, sx = x < 0 ? -1 : 1;
      // Rounded-rectangle distance field: distance to the edge and the outward direction there.
      let dist: number, ox: number, oy: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        dist = r - len;
        ox = (sx * qx) / len; oy = (sy * qy) / len;
      } else if (qx > qy) { dist = r - qx; ox = sx; oy = 0; }
      else { dist = r - qy; ox = 0; oy = sy; }
      const o = (py * w + px) * 4;
      if (dist < 0 || dist >= bezel) {
        D[o] = 128; D[o + 1] = 128; D[o + 2] = 0; D[o + 3] = 255;
        S[o] = 255; S[o + 1] = 255; S[o + 2] = 255; S[o + 3] = 0;
        continue;
      }
      // Interpolated between rays: rounding to the nearest ray let one px skip a ray and shed more than SLOPE.
      const f = (dist / bezel) * (RAYS - 1), i = Math.min(RAYS - 2, Math.floor(f)), u = f - i;
      // Positive magnitude moves the sample point inward (feDisplacementMap samples at +vector).
      const m = (t.mag[i] * (1 - u) + t.mag[i + 1] * u) / t.max;
      D[o] = Math.round(128 - ox * m * 127);
      D[o + 1] = Math.round(128 - oy * m * 127);
      // tilt² keeps the tint in the outer part of the bezel, clear of a label in the middle of a short control.
      D[o + 2] = Math.round(255 * t.tilt[Math.round(f)] ** 2);
      D[o + 3] = 255;
      const dot = ox * LIGHT.x + oy * LIGHT.y, facing = Math.max(0, dot);
      // The faint base rim fades out on edges turning away from the light (ramp over dot −0.25…0.25, so corners stay
      // smooth): on a dark field a rim along the bottom or right reads as a highlight on the wrong side.
      const base = 0.12 * Math.min(1, Math.max(0, (dot + 0.25) / 0.5));
      // The lip stays tilted across its dip, where the facing term splits at the midline and at the caps into a lit
      // rectangle; only its outer rim catches the light.
      const fade = profile === 'lip' ? (1 - dist / bezel) ** 2 : 1;
      S[o] = 255; S[o + 1] = 255; S[o + 2] = 255;
      S[o + 3] = Math.round(255 * t.tilt[Math.round(f)] * fade * (base + 0.88 * facing));
    }
  }
  // feDisplacementMap moves by scale × (R/255 − 0.5) and R = 128 + m·127, so scale = max·255/127 draws m·max px.
  return { D, S, scale: (t.max * 255) / 127 };
}

let scratch: HTMLCanvasElement | undefined;
function toDataUrl(img: ImageData): string {
  scratch ??= document.createElement('canvas');
  scratch.width = img.width;
  scratch.height = img.height;
  scratch.getContext('2d')!.putImageData(img, 0, 0);
  return scratch.toDataURL('image/png');
}

/** For tests and tooling: the raw ray table of a profile. */
export const _rays = table;
