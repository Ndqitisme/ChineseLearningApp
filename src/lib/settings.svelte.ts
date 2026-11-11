// User settings, shared by both windows through "settings.json" (see durable-store.ts).
// Store change events reach both windows, so a change in one shows in the other.
import { load, type Store } from './durable-store.ts';
import { dataset, levelIds, levelOf, loadLevels, wordByHanzi, wordById } from './data.ts';
import type { ThemeId } from './theme/themes.ts';
import { PET_SKINS, type PetSkin } from '../pet/skins.ts';
import type { HskEdition, HskLevel, Word } from './types.ts';

export type Mode = 'system' | 'light' | 'dark';
export type VoiceSlot = 'female' | 'male';
/** Colour tokens the user changed, kept apart for the light and the dark look. */
export type TokenOverrides = Record<'light' | 'dark', Record<string, string>>;

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
  tokenOverrides: TokenOverrides;
  customCss: string;
  petEnabled: boolean;
  /** false = a plain word bubble: no character and no border. */
  petSkinOn: boolean;
  petSkin: PetSkin;
  petScale: number;
  /** Seconds each word stays in the bubble. */
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
  /** HSK levels in the assistant's rotation, always within 1..hskOpen. */
  hsk: number[];
  /** Highest open HSK level, 3–6. Cumulative: 5 means HSK 1–5 are open. */
  hskOpen: number;
  /** HSK word list edition. Both load together, so switching needs no download. */
  hskEdition: HskEdition;
  speech: SpeechSettings;
  onboarded: boolean;
  /** Writing practice plays the stroke-order demo before each new character. */
  writeDemo: boolean;
  /** Bumped when a default changes in a way existing installs should follow (see initSettings). */
  settingsVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'ocean',
  mode: 'system',
  tokenOverrides: { light: {}, dark: {} },
  customCss: '',
  petEnabled: true,
  petSkinOn: true,
  petSkin: 'assistant',
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
  hskOpen: 3,
  hskEdition: 2025,
  speech: {
    provider: 'none', slot: 'female', voices: { female: '', male: '' }, rate: 0.9, autoplayInPet: false,
    http: { preset: 'openai', url: 'http://localhost:8880/v1/audio/speech', apiKey: '', model: 'kokoro', region: '' },
    packDir: '',
  },
  onboarded: false,
  writeDemo: true,
  settingsVersion: 5,
};

export const settings: Settings = $state(structuredClone(DEFAULT_SETTINGS));

let store: Store | undefined;
/** The highest level this run could load (see loadOpenLevels), and the open levels the store holds. */
let loadableMax = 6;
let stored: Pick<Settings, 'hskOpen' | 'hsk'> = { hskOpen: DEFAULT_SETTINGS.hskOpen, hsk: DEFAULT_SETTINGS.hsk };

export function normalize(s: Settings): Settings {
  const hskOpen = Math.min(6, Math.max(3, Math.trunc(Number(s.hskOpen)) || 3));
  const hskEdition = s.hskEdition === 2021 || s.hskEdition === 2025 ? s.hskEdition : DEFAULT_SETTINGS.hskEdition;
  // A saved 'bamboo' is read as a border skin, so the user keeps a border.
  const saved = (s.petSkin as string) === 'bamboo' ? 'leaf' : s.petSkin;
  const petSkin = PET_SKINS.some((k) => k.id === saved) ? saved : DEFAULT_SETTINGS.petSkin;
  return { ...s, hskOpen, hskEdition, petSkin, hsk: s.hsk.filter((l) => l >= 1 && l <= hskOpen) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `defaults` overlaid with the saved fields of the same type; a hand-edited or damaged file can hold anything. */
function sameTypes<T extends object>(defaults: T, saved: unknown): T {
  const out = { ...defaults } as Record<string, unknown>;
  if (!isRecord(saved)) return out as T;
  for (const [key, def] of Object.entries(defaults)) {
    const v = saved[key];
    if (Array.isArray(def) ? Array.isArray(v) : isRecord(def) ? isRecord(v) : typeof v === typeof def) out[key] = v;
  }
  return out as T;
}

const strings = (v: unknown): Record<string, string> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {};

/** Settings before version 4 held one map of colour overrides for both looks; it becomes the start of each. */
function tokenOverrides(v: unknown): TokenOverrides {
  if (isRecord(v) && (isRecord(v.light) || isRecord(v.dark))) return { light: strings(v.light), dark: strings(v.dark) };
  return { light: strings(v), dark: strings(v) };
}

/** Settings before version 5 had one switch for the character; it becomes the skin switch, with the character skin. */
function oldCharacterSwitch(saved: unknown): Partial<Settings> {
  if (!isRecord(saved) || typeof saved.petCharacter !== 'boolean' || typeof saved.petSkinOn === 'boolean') return {};
  return { petSkinOn: saved.petCharacter, petSkin: 'assistant' };
}

export function fromSaved(saved: unknown): Settings {
  const s = { ...sameTypes(DEFAULT_SETTINGS, saved), ...oldCharacterSwitch(saved), tokenOverrides: tokenOverrides(isRecord(saved) ? saved.tokenOverrides : undefined) };
  const speech = sameTypes(DEFAULT_SETTINGS.speech, s.speech);
  // normalize() accepts a hand-edited hskOpen such as "5", so it gets the raw value.
  const hskOpen = isRecord(saved) && saved.hskOpen !== undefined ? saved.hskOpen as number : s.hskOpen;
  return normalize({ ...s, hskOpen, speech: { ...speech,
    voices: sameTypes(DEFAULT_SETTINGS.speech.voices, speech.voices), http: sameTypes(DEFAULT_SETTINGS.speech.http, speech.http) } });
}

function merge(saved: unknown) {
  if (!saved) return;
  const s = fromSaved(saved);
  // Another window opened a different level: drop this run's start-up cap so the packs load again.
  if (s.hskOpen !== stored.hskOpen) { loadableMax = 6; startup.failedLevel = 0; }
  stored = { hskOpen: s.hskOpen, hsk: s.hsk };
  Object.assign(settings, normalize({ ...s, hskOpen: Math.min(s.hskOpen, loadableMax) }));
}

/** What an install saved by an older version must write once, or null when it is current. */
export function migration(saved: Partial<Settings> | undefined): Partial<Settings> | null {
  const version = saved?.settingsVersion ?? 1;
  if (!saved || version >= 5) return null;
  // Installs still on the old sakura default move to ocean once. Older installs get hskOpen's default (HSK 1–3) from merge().
  // Version 4 splits the colour overrides by look and version 5 turns the character switch into the skin switch;
  // fromSaved() already did both, so stamping the version saves the new shape.
  return { settingsVersion: 5, ...(version < 2 && saved.theme === 'sakura' ? { theme: 'ocean' as const } : {}) };
}

export async function initSettings() {
  store = await load('settings.json');
  const saved = await store.get<Partial<Settings>>('settings');
  merge(saved);
  const patch = migration(saved);
  if (patch) await updateSettings(patch);
  await store.onKeyChange<Settings>('settings', (v) => merge(v));
}

export async function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  const out = $state.snapshot(settings);
  // A level locked only for this run (its pack failed to load) stays saved open, so the next start retries it.
  if (!('hskOpen' in patch) && loadableMax < stored.hskOpen)
    Object.assign(out, { hskOpen: stored.hskOpen, hsk: [...out.hsk, ...stored.hsk.filter((l) => l > out.hskOpen)] });
  await store?.set('settings', out);
}

/** Opening HSK 1–`level`: levels above it leave the assistant's rotation; their review cards stay in progress. */
export function hskOpenPatch(s: Pick<Settings, 'hsk'>, level: number): Partial<Settings> {
  return { hskOpen: level, hsk: s.hsk.filter((l) => l <= level) };
}

/** Unlocks or re-locks. Packs load before the setting changes, so no page sees an open level without its words. */
export async function setHskOpen(level: number) {
  await loadLevels(level);
  loadableMax = 6;
  startup.failedLevel = 0;
  await updateSettings(hskOpenPatch(settings, level));
}

/** Set when an open level's pack could not be read at start-up, so the Topics page can say why it is locked. */
export const startup = $state({ failedLevel: 0 });

/** Loads the saved open levels at start-up. A pack that cannot be read leaves that level and above locked for this run, so the window still opens; unlocking retries the load. */
export async function loadOpenLevels() {
  try {
    await loadLevels(settings.hskOpen);
  } catch (e) {
    console.warn('HSK pack failed at start-up', e);
    let loaded = 3;
    while (loaded < settings.hskOpen && dataset.hsk[(loaded + 1) as HskLevel]) loaded++;
    startup.failedLevel = loaded + 1;
    loadableMax = loaded;
    Object.assign(settings, normalize({ ...settings, hskOpen: loaded }));
  }
}

/** A word's level in the chosen edition; undefined when that edition does not list it. */
export const hskLevel = (w: Word) => levelOf(w, settings.hskEdition);
/** Word ids of HSK `level` in the chosen edition; undefined while its pack is not loaded. */
export const hskIds = (level: HskLevel) => levelIds(settings.hskEdition)[level];

// Re-locking does not unload packs, so every list the learner sees filters through these.
/** Topic words always; HSK words only while the chosen edition lists them at an open level. */
export const isOpen = (w: Word) => {
  const level = hskLevel(w);
  return w.topics.length > 0 || (level !== undefined && level <= settings.hskOpen);
};
/** The word for `id` if it is loaded and open; review cards may name words that are neither. */
export function openWord(id: string): Word | undefined {
  // Read these even for a word that is not loaded yet, so derived lists re-run once its level opens.
  void settings.hskOpen;
  void settings.hskEdition;
  const w = wordById.get(id);
  return w && isOpen(w) ? w : undefined;
}
/** Topic words always; HSK words while either edition lists them at an open level. Review, the notebook, search
 * and word pages use this, so switching editions hides none of the learner's words. */
export const isOpenAnyEdition = (w: Word) =>
  w.topics.length > 0 || [w.hsk, w.hsk2025].some((level) => level !== undefined && level <= settings.hskOpen);
/** The word for `id` if it is loaded and open in either edition. */
export function openWordAnyEdition(id: string): Word | undefined {
  void settings.hskOpen;
  const w = wordById.get(id);
  return w && isOpenAnyEdition(w) ? w : undefined;
}
/** The open word written `hanzi`: hover and sentence tiles must not read a locked level's words. */
export function openByHanzi(hanzi: string): Word | undefined {
  const w = wordByHanzi.get(hanzi);
  return w && isOpen(w) ? w : undefined;
}
