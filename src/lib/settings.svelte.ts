// User settings, shared by both windows through tauri-plugin-store ("settings.json").
// The store emits change events app-wide, so a change made in one window shows up in the other.
import { load, type Store } from '@tauri-apps/plugin-store';
import type { ThemeId } from './theme/themes.ts';

export type Mode = 'system' | 'light' | 'dark';
export type VoiceSlot = 'female' | 'male';

export interface SpeechSettings {
  provider: 'none' | 'system' | 'http' | 'pack';
  slot: VoiceSlot;
  /** Voice name/id per slot, interpreted by the provider. */
  voices: Record<VoiceSlot, string>;
  rate: number;
  autoplayInPet: boolean;
  http: { preset: 'openai' | 'azure' | 'custom'; url: string; apiKey: string; model: string; region: string };
  packDir: string;
}

export interface Settings {
  theme: ThemeId;
  mode: Mode;
  tokenOverrides: Record<string, string>;
  customCss: string;
  petEnabled: boolean;
  petScale: number;
  /** How long each word stays in the bubble before the next one replaces it. */
  wordSec: number;
  guessFirst: boolean;
  showHanviet: boolean;
  showExample: boolean;
  hideOnFullscreen: boolean;
  idlePauseMin: number;
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  topics: string[];
  hsk: number[];
  speech: SpeechSettings;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'sakura',
  mode: 'system',
  tokenOverrides: {},
  customCss: '',
  petEnabled: true,
  petScale: 3,
  wordSec: 18,
  guessFirst: true,
  showHanviet: true,
  showExample: false,
  hideOnFullscreen: true,
  idlePauseMin: 3,
  quietEnabled: false,
  quietFrom: '22:30',
  quietTo: '07:00',
  topics: ['greetings', 'numbers-money', 'dishes', 'drinks', 'restaurant', 'office'],
  hsk: [1],
  speech: {
    provider: 'none', slot: 'female', voices: { female: '', male: '' }, rate: 0.9, autoplayInPet: false,
    http: { preset: 'openai', url: 'http://localhost:8880/v1/audio/speech', apiKey: '', model: 'kokoro', region: '' },
    packDir: '',
  },
  onboarded: false,
};

export const settings: Settings = $state(structuredClone(DEFAULT_SETTINGS));

let store: Store | undefined;

function merge(saved: Partial<Settings> | undefined) {
  if (!saved) return;
  Object.assign(settings, { ...DEFAULT_SETTINGS, ...saved, speech: { ...DEFAULT_SETTINGS.speech, ...saved.speech,
    http: { ...DEFAULT_SETTINGS.speech.http, ...saved.speech?.http } } });
}

export async function initSettings() {
  store = await load('settings.json', { autoSave: 300, defaults: {} });
  merge(await store.get<Partial<Settings>>('settings'));
  await store.onKeyChange<Settings>('settings', (v) => merge(v));
}

export async function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  await store?.set('settings', $state.snapshot(settings));
}
