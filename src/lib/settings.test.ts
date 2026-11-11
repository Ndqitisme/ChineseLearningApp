import { describe, expect, it } from 'vitest';
import hsk5 from '../generated/hsk5.json';
import { words } from './data.ts';
import { DEFAULT_SETTINGS, fromSaved, hskOpenPatch, isOpen, isOpenAnyEdition, migration, normalize, openWord, openWordAnyEdition, setHskOpen, settings, type Settings } from './settings.svelte.ts';
import type { LevelPack } from './types.ts';

const pack5 = hsk5 as unknown as LevelPack;
const withDefaults = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe('settings migration', () => {
  it('moves only pre-v2 installs off the old sakura default, and stamps v5', () => {
    expect(migration({ settingsVersion: 1, theme: 'sakura' })).toEqual({ settingsVersion: 5, theme: 'ocean' });
    expect(migration({ theme: 'sakura' })).toEqual({ settingsVersion: 5, theme: 'ocean' });
    // A version 2 install on sakura chose it, so it is kept.
    expect(migration({ settingsVersion: 2, theme: 'sakura' })).toEqual({ settingsVersion: 5 });
    expect(migration({ settingsVersion: 3 })).toEqual({ settingsVersion: 5 });
    expect(migration({ settingsVersion: 4 })).toEqual({ settingsVersion: 5 });
    expect(migration({ settingsVersion: 5 })).toBeNull();
    expect(migration(undefined)).toBeNull();
  });

  it('copies a version 3 colour override map to both the light and the dark look', () => {
    const v3 = { settingsVersion: 3, tokenOverrides: { primary: '#ff0000', bg: 7 } } as unknown as Partial<Settings>;
    expect(fromSaved(v3).tokenOverrides).toEqual({ light: { primary: '#ff0000' }, dark: { primary: '#ff0000' } });
    const v4 = { settingsVersion: 4, tokenOverrides: { light: { primary: '#ff0000' }, dark: { bg: '#000000' } } };
    expect(fromSaved(v4).tokenOverrides).toEqual(v4.tokenOverrides);
    expect(fromSaved({ tokenOverrides: { light: { primary: '#fff' } } }).tokenOverrides).toEqual({ light: { primary: '#fff' }, dark: {} });
  });

  it('turns the old character switch into the skin switch with the character skin', () => {
    expect(fromSaved({ settingsVersion: 4, petCharacter: false })).toMatchObject({ petSkinOn: false, petSkin: 'assistant' });
    expect(fromSaved({ settingsVersion: 4, petCharacter: true })).toMatchObject({ petSkinOn: true, petSkin: 'assistant' });
    // Never set, or damaged: the defaults.
    expect(fromSaved({ settingsVersion: 4 })).toMatchObject({ petSkinOn: true, petSkin: 'assistant' });
    expect(fromSaved({ settingsVersion: 4, petCharacter: 'no' })).toMatchObject({ petSkinOn: true, petSkin: 'assistant' });
    // The new fields win over a stale old one.
    expect(fromSaved({ petCharacter: false, petSkinOn: true, petSkin: 'leaf' })).toMatchObject({ petSkinOn: true, petSkin: 'leaf' });
    expect('petCharacter' in fromSaved({ petCharacter: false })).toBe(false);
  });

  it('reads the removed bamboo skin as the leaf skin', () => {
    expect(fromSaved({ petSkin: 'bamboo' }).petSkin).toBe('leaf');
  });

  it('reads an unknown skin as the character skin', () => {
    expect(fromSaved({ petSkin: 'gold' }).petSkin).toBe('assistant');
  });

  it('keeps a saved edition and reads a damaged one as the 2025 default', () => {
    expect(DEFAULT_SETTINGS.hskEdition).toBe(2025);
    expect(fromSaved({ hskEdition: 2021 }).hskEdition).toBe(2021);
    expect(fromSaved({ hskEdition: 1999 }).hskEdition).toBe(2025);
    expect(fromSaved({ hskEdition: '2021' }).hskEdition).toBe(2025);
  });

  it('opens HSK 1–3 for an install saved before hskOpen existed', () => {
    const v2 = { ...DEFAULT_SETTINGS, settingsVersion: 2, hsk: [1, 3], hskOpen: undefined as unknown as number };
    expect(normalize(v2)).toMatchObject({ hskOpen: 3, hsk: [1, 3] });
  });
});

describe('normalize', () => {
  it('clamps hskOpen to 3–6 and the assistant levels to 1..hskOpen', () => {
    expect(normalize(withDefaults({ hskOpen: 9 })).hskOpen).toBe(6);
    expect(normalize(withDefaults({ hskOpen: 1 })).hskOpen).toBe(3);
    expect(normalize(withDefaults({ hskOpen: '5' as unknown as number })).hskOpen).toBe(5);
    expect(normalize(withDefaults({ hskOpen: undefined as unknown as number })).hskOpen).toBe(3);
    expect(normalize(withDefaults({ hskOpen: 4, hsk: [0, 1, 4, 5, 7] })).hsk).toEqual([1, 4]);
  });
});

describe('fromSaved', () => {
  it('keeps saved fields and drops ones of the wrong type, so a damaged file cannot stop start-up', () => {
    expect(fromSaved({ hsk: null, topics: null, speech: null, tokenOverrides: null, mode: 42, wordSec: 30 })).toMatchObject({
      hsk: DEFAULT_SETTINGS.hsk, topics: DEFAULT_SETTINGS.topics, speech: DEFAULT_SETTINGS.speech, tokenOverrides: { light: {}, dark: {} }, mode: 'system', wordSec: 30,
    });
    expect(fromSaved({ speech: { provider: 'http', voices: null, http: 'x' } }).speech).toEqual({ ...DEFAULT_SETTINGS.speech, provider: 'http' });
    expect(fromSaved({ hskOpen: '5', hsk: [1, 6] })).toMatchObject({ hskOpen: 5, hsk: [1] });
    expect(fromSaved('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(fromSaved([1, 2])).toEqual(DEFAULT_SETTINGS);
  });
});

describe('unlock and re-lock', () => {
  it('unlocks cumulatively without touching the assistant levels', () => {
    expect(hskOpenPatch({ hsk: [1, 2] }, 6)).toEqual({ hskOpen: 6, hsk: [1, 2] });
  });

  it('re-locking drops the higher levels from the assistant rotation', () => {
    expect(hskOpenPatch({ hsk: [1, 4, 5, 6] }, 4)).toEqual({ hskOpen: 4, hsk: [1, 4] });
    expect(hskOpenPatch({ hsk: [5] }, 3)).toEqual({ hskOpen: 3, hsk: [] });
  });

  it('loads the pack before opening, and hides its words again after re-lock', async () => {
    const id = pack5.words.find((w) => w.hsk === 5)!.id;
    const topicWord5 = words.find((w) => w.hsk === 5 && w.topics.length)!;
    expect(openWord(id)).toBeUndefined();
    await setHskOpen(5);
    expect(settings.hskOpen).toBe(5);
    expect(openWord(id)?.hsk).toBe(5);
    await setHskOpen(3);
    // Still loaded (no unload on re-lock), but hidden.
    expect(openWord(id)).toBeUndefined();
    expect(openWord('không-có-từ-này')).toBeUndefined();
    // Topic words stay in the core and stay visible at any level.
    expect(isOpen(topicWord5)).toBe(true);
  });

  it('opens words by the chosen edition: a word listed in only one edition is hidden in the other', async () => {
    await setHskOpen(5);
    const only2025 = words.find((w) => !w.hsk && w.hsk2025 === 5 && !w.topics.length)!;
    const only2021 = words.find((w) => w.hsk === 1 && !w.hsk2025 && !w.topics.length)!;
    const moved = words.find((w) => w.hsk === 6 && w.hsk2025 === 4 && !w.topics.length)!;
    settings.hskEdition = 2021;
    expect([isOpen(only2025), isOpen(only2021), isOpen(moved)]).toEqual([false, true, false]);
    settings.hskEdition = 2025;
    expect([isOpen(only2025), isOpen(only2021), isOpen(moved)]).toEqual([true, false, true]);
    await setHskOpen(3);
  });

  it('keeps words of either edition open for review, notebook and search, within the open levels', async () => {
    const only2025 = words.find((w) => !w.hsk && w.hsk2025 === 3 && !w.topics.length)!;
    const only2021 = words.find((w) => w.hsk === 1 && !w.hsk2025 && !w.topics.length)!;
    await setHskOpen(5);
    const moved = words.find((w) => w.hsk === 6 && w.hsk2025 === 4 && !w.topics.length)!;
    const high = words.find((w) => w.hsk === 5 && w.hsk2025 === 5 && !w.topics.length)!;
    for (const edition of [2021, 2025] as const) {
      settings.hskEdition = edition;
      expect([only2025, only2021, moved, high].map(isOpenAnyEdition), `${edition}`).toEqual([true, true, true, true]);
      expect(openWordAnyEdition(only2025.id)?.id).toBe(only2025.id);
    }
    // A re-locked level stays hidden whatever the edition: moved is 2025 HSK 4, high is HSK 5 in both.
    await setHskOpen(4);
    expect([isOpenAnyEdition(moved), isOpenAnyEdition(high)]).toEqual([true, false]);
    await setHskOpen(3);
    expect([isOpenAnyEdition(moved), openWordAnyEdition(high.id)]).toEqual([false, undefined]);
    settings.hskEdition = DEFAULT_SETTINGS.hskEdition;
  });
});
