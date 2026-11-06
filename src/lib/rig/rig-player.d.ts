// Types for rig-player.js (plain JS so the offline tools under tools/skins can import the same file).
// Only what the app and the tools call is typed; pose and spec internals stay loose on purpose.

export interface RigPart { pos: [number, number]; rect: [number, number, number, number]; z?: number }
export interface RigJson {
  about: string;
  licence: string;
  frame: { w: number; h: number; artOffsetY?: number };
  atlas: { file: string; size: [number, number] };
  parts: Record<string, RigPart>;
  [key: string]: unknown;
}
export interface MotionSpec {
  camera: { yawDeg: number };
  frame: { pxPerM: number; originXPx: number; originYPx: number };
  clips: Record<string, any>;
  idle: any;
  stateMachine: { events: Record<string, any>; [key: string]: any };
  [key: string]: unknown;
}
/** One section of a clip: a one-shot, or the enter / loop / exit of a stateful clip. */
export interface Section { name: string; part: 'oneShot' | 'enter' | 'loop' | 'exit'; clip: any; parent: any }
export interface Pose { pose: Record<string, number[]>; expr: Record<string, number>; hipsOffset: number[]; [key: string]: unknown }
export interface DrawItem { z: number; mesh: string; mats: number[][]; alpha?: number; [key: string]: unknown }
export interface BuildOpts { planted?: boolean; clip?: string; part?: string | null; now?: number }
export interface BuildResult {
  items: DrawItem[];
  joints: Record<string, [number[], number[]]>;
  headView: string;
  headTurn: [number, number];
  headCentre: number[];
  pair: string | undefined;
  sig: { nums: number[]; keys: string };
}
export type AtlasSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement;

export class RigPlayer {
  constructor(o: {
    rig: RigJson; spec: MotionSpec; atlas: AtlasSource; canvas: HTMLCanvasElement;
    /** device px per 1x frame px */
    scale?: number;
    hardWeights?: boolean; xfade?: boolean; idAtlas?: AtlasSource | null;
  });
  rig: RigJson;
  spec: MotionSpec;
  canvas: HTMLCanvasElement;
  scale: number;
  stats: Record<string, any>;
  debugArm: any;
  lastPair: string | undefined;
  compTexSize: [number, number];
  /** Set to skip the seam-fill pass. */
  noFill?: boolean;
  section(name: string, part?: string): Section | undefined;
  resetMotion(): void;
  settled(): boolean;
  paint(items: DrawItem[], id?: false | 'all' | number): void;
  build(P: Pose, opts?: BuildOpts): BuildResult;
  draw(P: Pose, opts?: BuildOpts): BuildResult;
  drawSection(s: Section, t: number, idleT?: number): BuildResult;
  drawRest(): BuildResult;
  extent(name: string, mats: number[][], tm?: number[]): { maxX: number; minY: number };
  meshQuality(items: DrawItem[]): { foldPx: number; shearPx: number; maxAniso: number };
}

export type TimelineEvent = [number, string] | [number, string, object];
export interface Activity { busy: boolean; sleepLoop?: boolean; slow?: boolean; next?: number }
export interface PoseInfo { clip: string; part: string | null; planted: boolean }

export class Timeline {
  constructor(spec: MotionSpec, opts?: { seed?: number });
  spec: MotionSpec;
  events: TimelineEvent[];
  /** Appends an app event at timeline time t (ms); the scheduler re-runs on the next pose. */
  emit(t: number, name: string, data?: object): void;
  segsAt(t: number): any[];
  blinkAt(t: number): number;
  activity(t: number): Activity;
  poseAt(player: RigPlayer, t: number): { P: Pose; info: PoseInfo };
}

export interface LoopOpts {
  fps?: number; idleEventFps?: number; sleepFps?: number; presentPx?: number; idlePresentPx?: number;
  now?: () => number;
  onFrame?: (t: number, info: PoseInfo) => void;
  onTick?: (t: number, info: PoseInfo) => void;
}
export interface Loop {
  /** Timeline time now (ms since the loop started). */
  t(): number;
  /** An event was emitted: wake the loop at once. */
  poke(): void;
  setHidden(hidden: boolean): void;
  stop(): void;
}
export function startLoop(player: RigPlayer, timeline: Timeline, opts?: LoopOpts): Loop;
export function clipDuration(clip: any): number;
