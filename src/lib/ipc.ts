import { invoke } from '@tauri-apps/api/core';

export interface HitRect { x: number; y: number; w: number; h: number }

export const ipc = {
  openMain: (route?: string) => invoke('open_main', { route }),
  setHitRects: (rects: HitRect[]) => invoke('pet_set_hit_rects', { rects }),
  systemState: () => invoke<{ busy: boolean; idleSecs: number }>('system_state'),
};

/** App-wide events. Payload types are listed next to each name. */
export const EVENTS = {
  /** → pet. `{ id, known?, starred? }`: the pet window owns exposure data. */
  exposurePatch: 'exposure:patch',
  /** → pet. Tray menu: "toggle-pet" | "next" | "pause" | "resume". */
  trayCommand: 'tray:command',
  /** → pet. Fullscreen/presentation state flipped: boolean. */
  systemBusy: 'system:busy',
  /** → main. Hash route to open, e.g. "/word/吃". */
  navigate: 'main:navigate',
} as const;
