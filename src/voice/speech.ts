import { create } from 'zustand';

/**
 * Spoken replies. Two voices, chosen by the user:
 *  - 'gemini'  natural voice from the server (uses Gemini speech quota),
 *  - 'browser' the browser's built-in voice (free, more robotic),
 *  - 'off'     silent.
 * Default: Gemini when the server offers it, otherwise the browser's voice. A saved choice of Gemini falls back to the
 * browser's voice when the server cannot (or fails to) synthesize, so an answer is never silently lost.
 */
export type ReplyVoice = 'gemini' | 'browser' | 'off';

const STORAGE_KEY = 'tinker_voice_reply';

const readSaved = (): ReplyVoice | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'gemini' || value === 'browser' || value === 'off' ? value : null;
  } catch {
    return null;
  }
};

interface SpeechSettings {
  /** The user's explicit choice, or null for "automatic". */
  saved: ReplyVoice | null;
  /** A reply is being spoken right now. */
  speaking: boolean;
  /** The server can synthesize the natural voice (from /v1/me). */
  serverCanSpeak: boolean;
  choose(voice: ReplyVoice | null): void;
}

export const useSpeechSettings = create<SpeechSettings>((set) => ({
  saved: readSaved(),
  speaking: false,
  serverCanSpeak: false,
  choose: (voice) => {
    try {
      if (voice) localStorage.setItem(STORAGE_KEY, voice);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage blocked: the choice lasts for this tab */
    }
    set({ saved: voice });
    if (voice === 'off') stopSpeaking();
  },
}));

/** The voice that will actually be used. */
export function effectiveVoice(saved: ReplyVoice | null, serverCanSpeak: boolean): ReplyVoice {
  if (saved === 'off') return 'off';
  if (saved === 'browser') return 'browser';
  return serverCanSpeak ? 'gemini' : 'browser';
}

/** Raw base64 16-bit little-endian PCM to floats in [-1, 1]. */
export function pcmBase64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const view = new DataView(new ArrayBuffer(binary.length - (binary.length % 2)));
  for (let i = 0; i < view.byteLength; i++) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** What a voice should read: no markdown noise, no bracketed notices. */
export function speakable(raw: string): string {
  return raw
    .replace(/\([^)]*unavailable right now[^)]*\)/gi, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let stopCurrent: (() => void) | null = null;

export function stopSpeaking(): void {
  const stop = stopCurrent;
  stopCurrent = null;
  stop?.();
  useSpeechSettings.setState({ speaking: false });
}

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || !text) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    const done = () => {
      if (stopCurrent === cancel) stopCurrent = null;
      resolve();
    };
    const cancel = () => {
      synth.cancel();
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    stopCurrent = cancel;
    synth.cancel(); // never queue behind an older reply
    synth.speak(utterance);
  });
}

async function speakWithGemini(fetchAudio: () => Promise<{ audio: string; sampleRate: number }>): Promise<void> {
  const { audio, sampleRate } = await fetchAudio();
  const samples = pcmBase64ToFloat32(audio);
  if (samples.length === 0) throw new Error('empty audio');
  const context = new AudioContext();
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  await new Promise<void>((resolve) => {
    const cancel = () => {
      try {
        source.stop();
      } catch {
        /* not started */
      }
      resolve();
    };
    stopCurrent = cancel;
    source.onended = () => {
      if (stopCurrent === cancel) stopCurrent = null;
      resolve();
    };
    source.start();
  }).finally(() => void context.close());
}

export interface SpeakRequest {
  text: string;
  /** Asks the server to synthesize this reply (the server only accepts the id of a stored assistant message). */
  fetchAudio: () => Promise<{ audio: string; sampleRate: number }>;
  serverCanSpeak: boolean;
}

/**
 * Read a reply aloud with the chosen voice. Resolves when it finished (or was stopped). Never throws: failing to speak must not
 * break anything. A failure of the Gemini voice falls back to the browser voice.
 */
export async function speakReply({ text, fetchAudio, serverCanSpeak }: SpeakRequest): Promise<void> {
  const voice = effectiveVoice(useSpeechSettings.getState().saved, serverCanSpeak);
  const plain = speakable(text);
  if (voice === 'off' || !plain) return;
  stopSpeaking();
  useSpeechSettings.setState({ speaking: true });
  try {
    if (voice === 'gemini') {
      try {
        await speakWithGemini(fetchAudio);
        return;
      } catch {
        /* fall back to the browser voice below */
      }
    }
    await speakWithBrowser(plain);
  } finally {
    useSpeechSettings.setState({ speaking: false });
  }
}
