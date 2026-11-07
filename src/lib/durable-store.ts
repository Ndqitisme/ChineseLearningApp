// settings.json and progress.json, kept by src-tauri/src/store.rs. Every write is sent to both windows,
// the writer included, as a "store:change" event.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type StoreName = 'settings.json' | 'progress.json';

interface Change { name: StoreName; key: string; value: unknown }

export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  onKeyChange<T>(key: string, cb: (value: T | undefined) => void): Promise<UnlistenFn>;
}

export async function load(name: StoreName): Promise<Store> {
  const entries = await invoke<Record<string, unknown>>('store_load', { name });
  const onChange = (cb: (c: Change) => void) => listen<Change>('store:change', ({ payload }) => { if (payload.name === name) cb(payload); });
  await onChange((c) => { entries[c.key] = c.value; });
  return {
    get: async <T>(key: string) => entries[key] as T | undefined,
    set: async (key, value) => {
      entries[key] = value;
      await invoke('store_set', { name, key, value });
    },
    onKeyChange: <T>(key: string, cb: (value: T | undefined) => void) =>
      onChange((c) => { if (c.key === key) cb(c.value as T); }),
  };
}
