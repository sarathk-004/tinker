// Gemini Native Voice Model API
// Invokes Google's multimodal Gemini Audio models (gemini-2.0-flash, gemini-3.8-flash, gemini-2.0-flash-lite, gemini-2.0-flash-exp)
// Uses native 24kHz PCM linear audio synthesis decoded directly in browser via Web Audio API

import { cleanTextForSpeech, speakText as fallbackSpeak, stopSpeaking as fallbackStop } from './speechSynthesis';

export interface GeminiAudioModel {
  id: string;
  name: string;
  tag: string;
  description: string;
}

export const GEMINI_AUDIO_MODELS: GeminiAudioModel[] = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash Audio',
    tag: 'Production',
    description: 'Flagship multimodal audio engine with native speech generation and natural cadence.',
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash Audio',
    tag: 'Next-Gen',
    description: 'Ultra-fast multimodal reasoning with direct audio synthesis.',
  },
  {
    id: 'gemini-2.0-flash-lite',
    name: 'Gemini 2.0 Flash Lite',
    tag: 'Low-Latency',
    description: 'Optimized for rapid voice interactions and instant playback.',
  },
  {
    id: 'gemini-2.0-flash-exp',
    name: 'Gemini 2.0 Live Audio',
    tag: 'Experimental',
    description: 'Experimental live voice model with dynamic expressive modulation.',
  },
];

let currentAudioSource: AudioBufferSourceNode | null = null;
let currentAudioContext: AudioContext | null = null;

export function getSelectedGeminiAudioModel(): string {
  if (typeof window === 'undefined') return 'gemini-2.0-flash';
  return localStorage.getItem('tinker_gemini_audio_model') || 'gemini-2.0-flash';
}

export function setSelectedGeminiAudioModel(modelId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('tinker_gemini_audio_model', modelId);
}

/**
 * Decode base64 24kHz linear PCM audio to Web Audio AudioBuffer
 */
function decodePcm24k(base64Data: string, sampleRate = 24000): AudioBuffer {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // 16-bit signed integer linear PCM
  const int16Array = new Int16Array(bytes.buffer);
  const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtxClass();
  const audioBuffer = audioCtx.createBuffer(1, int16Array.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);

  for (let i = 0; i < int16Array.length; i++) {
    channelData[i] = int16Array[i] / 32768.0;
  }

  return audioBuffer;
}

/**
 * Stop any ongoing Gemini or browser speech audio
 */
export function stopVoice(): void {
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
      currentAudioSource.disconnect();
    } catch (_) {}
    currentAudioSource = null;
  }
  fallbackStop();
}

/**
 * Synthesize speech using Google Gemini's native Audio Model API
 */
export async function speakWithGeminiVoice(
  text: string,
  preferredModelId?: string
): Promise<void> {
  const isMuted = localStorage.getItem('tinker_tts_muted') === 'true';
  if (isMuted) return;

  const clean = cleanTextForSpeech(text);
  if (!clean) return;

  // Stop any active audio before starting new playback
  stopVoice();

  const apiKey =
    localStorage.getItem('tinker_gemini_api_key') ||
    localStorage.getItem('tinker_gemini_key') ||
    (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '');

  // If no Gemini API key is configured, fallback to offline browser speech
  if (!apiKey) {
    fallbackSpeak(clean);
    return;
  }

  const primaryModel = preferredModelId || getSelectedGeminiAudioModel();
  const modelCandidates = [
    primaryModel,
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ].filter((v, i, a) => a.indexOf(v) === i);

  let audioPlayed = false;

  for (const model of modelCandidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Please respond by reading aloud the following system design update concisely and with natural human inflection:\n\n"${clean}"`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Aoede',
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const audioPart = parts.find(
        (p: { inlineData?: { mimeType: string; data: string } }) =>
          p.inlineData && p.inlineData.data
      );

      if (audioPart && audioPart.inlineData?.data) {
        const mimeType = audioPart.inlineData.mimeType || 'audio/pcm;rate=24000';
        const sampleRateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;

        const audioBuffer = decodePcm24k(audioPart.inlineData.data, sampleRate);

        if (!currentAudioContext || currentAudioContext.state === 'closed') {
          const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          currentAudioContext = new AudioCtxClass();
        }
        if (currentAudioContext.state === 'suspended') {
          await currentAudioContext.resume();
        }

        const source = currentAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(currentAudioContext.destination);
        currentAudioSource = source;

        source.onended = () => {
          if (currentAudioSource === source) {
            currentAudioSource = null;
          }
        };

        source.start();
        audioPlayed = true;
        break;
      }
    } catch (err) {
      console.warn(`Failed audio generation with ${model}:`, err);
    }
  }

  // Graceful fallback if Gemini API network error occurs
  if (!audioPlayed) {
    fallbackSpeak(clean);
  }
}
