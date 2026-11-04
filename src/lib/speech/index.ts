// Pronunciation is optional and pluggable: nothing is bundled. Providers:
//  - system: the OS voices exposed through speechSynthesis (user installs zh-CN voices)
//  - http:   an external TTS API, called through Rust (no CORS, cached on disk)
//  - pack:   a local voice pack folder of pre-generated clips
import { settings, type VoiceSlot } from '../settings.svelte.ts';
import { httpClip, packClip } from './native.ts';

export interface VoiceInfo { id: string; label: string; local: boolean }

export function chineseSystemVoices(): VoiceInfo[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => /^(zh|cmn)([-_](CN|Hans))?/i.test(v.lang))
    .map((v) => ({ id: v.voiceURI, label: `${v.name} (${v.lang})`, local: v.localService }));
}

/** Voices load asynchronously in some engines; resolves once the list is populated (or after 1.5 s). */
export function whenVoicesReady(): Promise<void> {
  if (typeof speechSynthesis === 'undefined' || speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((ok) => {
    const done = () => { speechSynthesis.removeEventListener('voiceschanged', done); ok(); };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, 1500);
  });
}

export function speechAvailable(): boolean {
  return settings.speech.provider !== 'none';
}

let audio: HTMLAudioElement | undefined;
let audioUrl: string | undefined;

async function playBytes(bytes: ArrayBuffer, mime: string) {
  audio?.pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  audio = new Audio(audioUrl);
  await audio.play();
}

/** Speaks Chinese text with the chosen slot's voice. Throws with a readable message on failure. */
export async function speak(text: string, slot: VoiceSlot = settings.speech.slot): Promise<void> {
  const s = settings.speech;
  switch (s.provider) {
    case 'none':
      return;
    case 'system': {
      await whenVoicesReady();
      const voices = speechSynthesis.getVoices();
      const voice = voices.find((v) => v.voiceURI === s.voices[slot]) ?? voices.find((v) => /^zh/i.test(v.lang));
      if (!voice) throw new Error('Máy chưa có giọng tiếng Trung. Hãy cài giọng zh-CN trong cài đặt hệ thống.');
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = s.rate;
      speechSynthesis.speak(u);
      return;
    }
    case 'http': {
      const { bytes, mime } = await httpClip(text, slot);
      return playBytes(bytes, mime);
    }
    case 'pack': {
      const bytes = await packClip(text, slot);
      return playBytes(bytes, 'audio/mpeg');
    }
  }
}
