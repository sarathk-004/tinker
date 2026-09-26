// Google Gemini Native Multimodal Voice API
// Exclusively uses Gemini Audio Models (gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts, gemini-3.1-flash-tts-preview)
// Native WAV/PCM decoding directly in browser via Web Audio API
// Absolutely NO synthetic browser/Microsoft Windows OS fallback voices

export interface GeminiAudioModel {
  id: string;
  name: string;
  tag: string;
  description: string;
}

export const GEMINI_AUDIO_MODELS: GeminiAudioModel[] = [
  {
    id: 'gemini-3.8-flash-tts',
    name: 'Gemini 3.8 Flash Audio (TTS)',
    tag: 'Production',
    description: 'Flagship Gemini 3.8 Flash audio engine with warm human inflection and soft acoustic presence.',
  },
  {
    id: 'gemini-3.8-flash-lite-tts',
    name: 'Gemini 3.8 Flash Lite Audio',
    tag: 'Fast',
    description: 'Low-latency conversational synthesis for rapid voice responses.',
  },
  {
    id: 'gemini-3.1-flash-tts-preview',
    name: 'Gemini 3.1 Flash Audio',
    tag: 'Fallback',
    description: 'Resilient Gemini audio model for high-fidelity speech.',
  },
];

export const GEMINI_VOICES = [
  { id: 'Kore', name: 'Kore (Soft & Warm)', description: 'Calm, gentle, and conversational signature Gemini voice' },
  { id: 'Puck', name: 'Puck (Natural & Lively)', description: 'Clear and dynamic conversational tone' },
  { id: 'Fenrir', name: 'Fenrir (Deep & Smooth)', description: 'Relaxed and authoritative architectural voice' },
];

let currentAudioSource: AudioBufferSourceNode | null = null;
let currentAudioContext: AudioContext | null = null;

const audioBufferCache = new Map<string, AudioBuffer>();

export function getSelectedGeminiAudioModel(): string {
  if (typeof window === 'undefined') return 'gemini-3.8-flash-lite-tts';
  const stored = localStorage.getItem('tinker_gemini_audio_model');
  if (stored && stored.endsWith('-tts')) return stored;
  return 'gemini-3.8-flash-lite-tts';
}

export function setSelectedGeminiAudioModel(modelId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('tinker_gemini_audio_model', modelId);
}

export function getSelectedGeminiVoice(): string {
  if (typeof window === 'undefined') return 'Kore';
  return localStorage.getItem('tinker_gemini_voice_name') || 'Kore';
}

export function setSelectedGeminiVoice(voiceName: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('tinker_gemini_voice_name', voiceName);
}

/**
 * Clean text for natural speech synthesis.
 * For ultra-low latency, extracts the punchy core answer (first sentence, max 20 words).
 * Full explanations remain visible in the left history chat for reading.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`([^`]+)`/g, '$1') // Inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
    .replace(/\*([^*]+)\*/g, '$1') // Italic
    .replace(/#{1,6}\s+/g, '') // Headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .replace(/^\s*[-*+]\s+/gm, '') // Bullet lists
    .replace(/^\s*\d+\.\s+/gm, '') // Numbered lists
    .replace(/\n{2,}/g, '. ') // Paragraphs to pause
    .replace(/\n/g, ' ')
    .trim();

  // Extract first punchy sentence (up to ~20 words) so TTS synthesizes rapidly with minimal latency
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  const firstSentence = (sentences[0] || cleaned).trim();
  const words = firstSentence.split(/\s+/);
  if (words.length > 20) {
    return words.slice(0, 20).join(' ') + '.';
  }
  return firstSentence;
}

/**
 * Decode base64 WAV or PCM into an AudioBuffer using the browser's Web Audio API
 */
async function decodeAudioPayload(
  base64Data: string,
  audioCtx: AudioContext,
  sampleRate = 24000
): Promise<AudioBuffer> {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Check if payload is a standard RIFF WAV container
  const isWav =
    len >= 12 &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46; // 'F'

  if (isWav) {
    // Standard WAV: browser native decoder provides flawless 24kHz/48kHz playback
    try {
      const bufferCopy = bytes.buffer.slice(0);
      return await audioCtx.decodeAudioData(bufferCopy);
    } catch (e) {
      console.warn('WAV native decode failed, falling back to raw PCM:', e);
    }
  }

  // Fallback: 16-bit linear PCM decoding
  const int16Array = new Int16Array(bytes.buffer);
  const audioBuffer = audioCtx.createBuffer(1, int16Array.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < int16Array.length; i++) {
    channelData[i] = int16Array[i] / 32768.0;
  }
  return audioBuffer;
}

/**
 * Stop any ongoing Gemini voice playback
 */
export function stopVoice(): void {
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
      currentAudioSource.disconnect();
    } catch (_) {}
    currentAudioSource = null;
  }
}

/**
 * Synthesize speech exclusively using Google Gemini Audio models.
 * Completely excludes Microsoft/OS default TTS engines.
 */
export async function speakWithGeminiVoice(
  text: string,
  preferredModelId?: string
): Promise<void> {
  const isMuted = localStorage.getItem('tinker_tts_muted') === 'true';
  if (isMuted) return;

  const clean = cleanTextForSpeech(text);
  if (!clean) return;

  // Stop any active audio
  stopVoice();

  const selectedVoice = getSelectedGeminiVoice();
  const cacheKey = `${selectedVoice}_${clean}`;

  // Check in-memory audio cache for instant sub-millisecond replay
  if (audioBufferCache.has(cacheKey)) {
    const cachedBuffer = audioBufferCache.get(cacheKey)!;
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!currentAudioContext || currentAudioContext.state === 'closed') {
      currentAudioContext = new AudioCtxClass();
    }
    if (currentAudioContext.state === 'suspended') {
      await currentAudioContext.resume();
    }
    const source = currentAudioContext.createBufferSource();
    source.buffer = cachedBuffer;

    const biquadFilter = currentAudioContext.createBiquadFilter();
    biquadFilter.type = 'lowpass';
    biquadFilter.frequency.value = 14000;

    const gainNode = currentAudioContext.createGain();
    gainNode.gain.value = 1.0;

    source.connect(biquadFilter);
    biquadFilter.connect(gainNode);
    gainNode.connect(currentAudioContext.destination);

    currentAudioSource = source;
    source.start();
    return;
  }

  const apiKey =
    localStorage.getItem('tinker_gemini_api_key') ||
    localStorage.getItem('tinker_gemini_key') ||
    (typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GEMINI_API_KEY
      : '');

  if (!apiKey) {
    console.warn('Gemini Voice: No API key available in .env or settings.');
    return;
  }

  // Only Gemini TTS audio models — prioritizing lowest-latency flash-lite-tts
  const chosenModel = preferredModelId || getSelectedGeminiAudioModel();
  const primaryModel = chosenModel.endsWith('-tts') ? chosenModel : 'gemini-3.8-flash-lite-tts';
  const modelCandidates = [
    primaryModel,
    'gemini-3.8-flash-lite-tts',
    'gemini-3.8-flash-tts',
    'gemini-3.1-flash-tts-preview',
  ].filter((v, i, a) => a.indexOf(v) === i && v.endsWith('-tts'));

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
                  text: clean,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: selectedVoice,
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        console.warn(`Gemini Audio ${model} returned HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const audioPart = parts.find(
        (p: { inlineData?: { mimeType: string; data: string } }) =>
          p.inlineData && p.inlineData.data
      );

      if (audioPart && audioPart.inlineData?.data) {
        const mimeType = audioPart.inlineData.mimeType || 'audio/wav';
        const sampleRateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;

        // Initialize AudioContext
        const AudioCtxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!currentAudioContext || currentAudioContext.state === 'closed') {
          currentAudioContext = new AudioCtxClass();
        }
        if (currentAudioContext.state === 'suspended') {
          await currentAudioContext.resume();
        }

        const audioBuffer = await decodeAudioPayload(
          audioPart.inlineData.data,
          currentAudioContext,
          sampleRate
        );

        // Cache buffer in memory for instant reuse
        if (audioBufferCache.size > 50) {
          audioBufferCache.clear();
        }
        audioBufferCache.set(cacheKey, audioBuffer);

        const source = currentAudioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Soft studio-quality warmth filter (subtle roll-off of digital harshness)
        const filter = currentAudioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 14000; // Preserve vocal clarity while softening harsh sibilance

        source.connect(filter);
        filter.connect(currentAudioContext.destination);
        currentAudioSource = source;

        source.onended = () => {
          if (currentAudioSource === source) {
            currentAudioSource = null;
          }
        };

        source.start();
        return; // Successfully played pure Gemini audio
      }
    } catch (err) {
      console.warn(`Gemini Voice attempt failed on ${model}:`, err);
    }
  }

  // Never fall back to Microsoft Windows OS voice
  console.warn('Gemini Voice: Audio generation failed on all Gemini models. Silent fallback (no OS TTS).');
}
