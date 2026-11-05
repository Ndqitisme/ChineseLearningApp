// Assistant character: a pre-rendered sprite sheet (tools/skins/makehuman) and a manifest
// mapping animation names to frames. Rendering offline keeps 3D engines out of the app.

export type AnimationName =
  | 'idle' | 'breathe' | 'blink' | 'look' | 'wink' | 'think' | 'talk' | 'wave' | 'happy' | 'drag' | 'sleep';

/** [frame index, duration ms]; a final duration of 0 holds that frame. */
export type FrameStep = [number, number];

export interface Skin {
  name: string;
  frameW: number;
  frameH: number;
  columns: number;
  count: number;
  rows: number;
  url: string;
  /** Direction the artwork faces; mirrored at render time so it faces the screen centre. */
  facing: 'front' | 'left' | 'right';
  /** Visible character box as fractions of a frame (for click-through hit testing). */
  hit: { x: number; y: number; w: number; h: number };
  animations: Partial<Record<AnimationName, FrameStep[]>>;
  credit: { title: string; license: string; url: string };
}

export const LOOPING: ReadonlySet<AnimationName> = new Set(['sleep']);

let loading: Promise<Skin> | undefined;

export function loadSkin(): Promise<Skin> {
  loading ??= (async () => {
    const res = await fetch('/skins/assistant/skin.json');
    if (!res.ok) throw new Error('assistant skin missing — run pnpm skin:render and skin:pack (see README)');
    const m = await res.json();
    return { ...m, url: '/skins/assistant/sheet.webp', rows: Math.ceil(m.count / m.columns) } as Skin;
  })();
  return loading;
}

/** On-screen height (CSS px) for the size setting: 2 = small, 3 = medium, 4 = large. */
const TARGET_H: Record<number, number> = { 2: 160, 3: 210, 4: 270 };

export function displayScale(skin: Pick<Skin, 'frameH'>, size: number): number {
  return (TARGET_H[size] ?? TARGET_H[3]) / skin.frameH;
}
