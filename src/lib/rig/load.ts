// Assistant character: a layered 2D rig (public/skins/assistant) drawn by rig-player.js on a WebGL canvas.
import type { MotionSpec, RigJson } from './rig-player.js';

/** Frame size in 1x px; rig.json must agree (window sizing needs it before the rig loads). */
export const FRAME = { w: 139, h: 340 } as const;

/** On-screen height (CSS px) for the size setting: 2 = small, 3 = medium, 4 = large. */
const TARGET_H: Record<number, number> = { 2: 160, 3: 210, 4: 270 };

/** CSS px per frame px for settings.petScale. */
export function displayScale(size: number): number {
  return (TARGET_H[size] ?? TARGET_H[3]) / FRAME.h;
}

/** Visible character box as fractions of the frame (click-through hit testing). */
export interface HitRect { x: number; y: number; w: number; h: number }

/** Union of the rest-pose drawings (every part except the other left-arm key poses). Part rects are 2x texels. */
export function hitRect(rig: RigJson): HitRect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [name, p] of Object.entries(rig.parts)) {
    if (name.startsWith('leftArm.') && name !== 'leftArm.rest') continue;
    x0 = Math.min(x0, p.pos[0]); y0 = Math.min(y0, p.pos[1]);
    x1 = Math.max(x1, p.pos[0] + p.rect[2] / 2); y1 = Math.max(y1, p.pos[1] + p.rect[3] / 2);
  }
  return { x: x0 / rig.frame.w, y: y0 / rig.frame.h, w: (x1 - x0) / rig.frame.w, h: (y1 - y0) / rig.frame.h };
}

export interface RigAssets { rig: RigJson; spec: MotionSpec; atlas: ImageBitmap; hit: HitRect }

let loading: Promise<RigAssets> | undefined;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`assistant rig missing: ${url} (${res.status})`);
  return res;
}

/** Loads rig.json, motion-spec.json and the atlas once; every canvas shares the decoded bitmap. */
export function loadRig(): Promise<RigAssets> {
  loading ??= (async () => {
    const [rig, spec, blob] = await Promise.all([
      fetchOk('/skins/assistant/rig.json').then((r) => r.json() as Promise<RigJson>),
      fetchOk('/skins/assistant/motion-spec.json').then((r) => r.json() as Promise<MotionSpec>),
      fetchOk('/skins/assistant/atlas.webp').then((r) => r.blob()),
    ]);
    if (rig.frame.w !== FRAME.w || rig.frame.h !== FRAME.h) throw new Error(`rig frame ${rig.frame.w}x${rig.frame.h}, expected ${FRAME.w}x${FRAME.h}`);
    const atlas = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
    return { rig, spec, atlas, hit: hitRect(rig) };
  })();
  return loading;
}
