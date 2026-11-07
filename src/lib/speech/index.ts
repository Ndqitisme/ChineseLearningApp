// Pronunciation is optional and pluggable: nothing is bundled. Providers:
//  - system: the OS voices exposed through speechSynthesis (user installs zh-CN voices)
//  - http:   an external TTS API, called through Rust (no CORS, cached on disk)
//  - pack:   a local voice pack folder of pre-generated clips
import { settings, type VoiceSlot } from '../settings.svelte.ts';
import { httpClip, packClip } from './native.ts';

export interface VoiceInfo { id: string; name: string; label: string; local: boolean }

const CHINESE = /^(zh|cmn)([-_](CN|Hans))?/i;

export function chineseSystemVoices(): VoiceInfo[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => CHINESE.test(v.lang))
    .map((v) => ({ id: v.voiceURI, name: v.name, label: `${v.name} (${v.lang})`, local: v.localService }));
}

// Voice names carry no gender field. These are the names of the common zh voices: Windows (Huihui, Yaoyao,
// Kangkang), Microsoft neural (Xiao… female, Yun… male) and macOS (Tingting, Meijia, Sinji, Lili, Li-mu).
const GENDER: Record<VoiceSlot, RegExp> = {
  male: /kangkang|\byun|li-?mu|\bmale\b/i,
  female: /huihui|yaoyao|\bxiao|tingting|meijia|sinji|lili|\bfemale\b/i,
};

/** "Tự chọn": the first voice whose name says it is the slot's gender; undefined when none does. */
export function autoVoice<V extends { name: string }>(voices: V[], slot: VoiceSlot): V | undefined {
  return voices.find((v) => GENDER[slot].test(v.name));
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

export type SpeechPhase = 'start' | 'end';
type SpeechListener = (phase: SpeechPhase, token: number) => void;
const listeners = new Set<SpeechListener>();
let nextToken = 0;

/**
 * When sound starts and ends, with a token per speak() call. A replaced utterance ends late with its own
 * token, so a listener can tell it from the current one. The speak() promise is no substitute: it resolves
 * when playback starts.
 */
export function onSpeech(fn: SpeechListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notify(phase: SpeechPhase, token: number) {
  for (const fn of listeners) fn(phase, token);
}

let audio: HTMLAudioElement | undefined;
let audioToken = 0;
let audioUrl: string | undefined;
// Held so the utterance is not garbage-collected mid-speech: Chromium then never fires its end event.
let utterance: SpeechSynthesisUtterance | undefined;

async function playBytes(bytes: ArrayBuffer, mime: string, token: number) {
  if (audio && !audio.ended) { audio.pause(); notify('end', audioToken); }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  audio = new Audio(audioUrl);
  audioToken = token;
  audio.onplaying = () => notify('start', token);
  audio.onended = audio.onerror = () => notify('end', token);
  await audio.play();
}

/** Speaks Chinese text with the chosen slot's voice. Throws with a readable message on failure. */
export async function speak(text: string, slot: VoiceSlot = settings.speech.slot): Promise<void> {
  const s = settings.speech;
  const token = ++nextToken;
  switch (s.provider) {
    case 'none':
      return;
    case 'system': {
      await whenVoicesReady();
      const voices = speechSynthesis.getVoices();
      const zh = voices.filter((v) => CHINESE.test(v.lang));
      // With no voice of the slot's gender, the other one still reads; Settings says which voice that is.
      const voice = voices.find((v) => v.voiceURI === s.voices[slot]) ?? autoVoice(zh, slot) ?? zh[0];
      if (!voice) throw new Error('Máy chưa có giọng tiếng Trung. Hãy cài giọng zh-CN trong cài đặt hệ thống.');
      speechSynthesis.cancel();
      const u = (utterance = new SpeechSynthesisUtterance(text));
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = s.rate;
      u.onstart = () => notify('start', token);
      u.onend = u.onerror = () => notify('end', token);
      speechSynthesis.speak(u);
      return;
    }
    case 'http': {
      const { bytes, mime } = await httpClip(text, slot);
      return playBytes(bytes, mime, token);
    }
    case 'pack': {
      const bytes = await packClip(text, slot);
      return playBytes(bytes, 'audio/mpeg', token);
    }
  }
}
