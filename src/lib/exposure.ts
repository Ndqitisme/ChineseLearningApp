import { emitTo } from '@tauri-apps/api/event';
import { EVENTS } from './ipc.ts';

/** Exposure data belongs to the pet window; other windows ask it to change a flag. */
export function requestExposurePatch(id: string, patch: { known?: boolean; starred?: boolean }) {
  return emitTo('pet', EVENTS.exposurePatch, { id, ...patch });
}
