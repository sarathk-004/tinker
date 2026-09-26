// Gemini Nuanced Voice Synthesis
// Uses Google's official Gemini Voice models (Aoede, Puck, Kore, Charon, Fenrir)
// Plays high-fidelity 24kHz PCM audio natively via Web Audio API without Python libraries

import { cleanTextForSpeech, speakText as fallbackSpeak, stopSpeaking as fallbackStop } from './speechSynthesis';

export type GeminiVoiceName = 'Aoede' | 'Puck' | 'Kore' | 'Charon' | 'Fenrir';

let currentAudioSource: AudioBufferSourceNode | null = null;
let currentAudioContext: AudioContext | null = null;

export const AVAILABLE_GEMINI_VOICES: Array<{ name: GeminiVoiceName; label: string; gender: string; style: string }> = [
  { name: 'Aoede', label: 'Aoede', gender: 'Female', style: 'Nuanced & Expressive' },
  { name: 'Puck', label: 'Puck', gender: 'Male', style: 'Lively & Conversational' },
  { name: 'Kore', label: 'Kore', gender: 'Female', style: 'Calm & Professional' },
  { name: 'Charon', label: 'Charon', gender: 'Male', style: 'Deep & Authoritative' },
  { name: 'Fenrir', label: 'Fenrir', gender: 'Male', style: 'Clear & Articulate' },
];

export function getSelectedGeminiVoice(): GeminiVoiceName {
  if (typeof window === 'undefined') return 'Aoede';
  return (localStorage.getItem('tinker_gemini_voice') as GeminiVoiceName) || 'Aoede';
}

export function setSelectedGeminiVoice(voice: GeminiVoiceName): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('tinker_gemini_voice', voice);
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

  // 16-bit signed integer PCM
  const int16Array = new Int16Array(bytes.buffer);
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
 * Speak text using Google's nuanced Gemini Voice models
 */
export async function speakWithGeminiVoice(
  text: string,
  preferredVoice?: GeminiVoiceName
): Promise<void> {
  const isMuted = localStorage.getItem('tinker_tts_muted') === 'true';
  if (isMuted) return;

  const clean = cleanTextForSpeech(text);
  if (!clean) return;

  // Stop any active speech first
  stopVoice();

  const apiKey =
    localStorage.getItem('tinker_gemini_key') ||
    (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '');

  const voiceName = preferredVoice || getSelectedGeminiVoice();

  // If no Gemini API key is configured, smoothly fallback to high-quality browser synthesis
  if (!apiKey) {
    fallbackSpeak(clean);
    return;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const promptText = `Speak the following message with human warmth, nuance, and conversational cadence:\n\n"${clean}"`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: promptText }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName,
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      console.warn('Gemini Voice API request failed, using natural fallback:', response.status);
      fallbackSpeak(clean);
      return;
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
        currentAudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
    } else {
      // If response had no inline audio part, fallback gracefully
      fallbackSpeak(clean);
    }
  } catch (err) {
    console.warn('Error invoking Gemini Voice:', err);
    fallbackSpeak(clean);
  }
}
