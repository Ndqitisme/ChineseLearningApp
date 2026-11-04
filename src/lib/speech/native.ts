import { invoke } from '@tauri-apps/api/core';
import { settings, type VoiceSlot } from '../settings.svelte.ts';

export interface VoicePackManifest {
  name: string;
  license: string;
  format: string;
  voices: Partial<Record<VoiceSlot, string>>;
}

/** Fetches (or reads from the disk cache) a clip from the configured HTTP TTS API. */
export async function httpClip(text: string, slot: VoiceSlot): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const s = settings.speech;
  const bytes = await invoke<ArrayBuffer>('tts_http', {
    request: { ...s.http, voice: s.voices[slot], text, rate: s.rate },
  });
  return { bytes, mime: '' };
}

export function packClip(text: string, slot: VoiceSlot): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('voicepack_clip', { dir: settings.speech.packDir, slot, text });
}

export function packInfo(dir: string): Promise<VoicePackManifest> {
  return invoke<VoicePackManifest>('voicepack_info', { dir });
}
