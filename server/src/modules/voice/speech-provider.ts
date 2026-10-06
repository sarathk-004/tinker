import { ProviderError } from '../ai/providers/types.ts';

/**
 * Text to speech, behind the same kind of seam as the other model gateways. Used only to read a stored assistant message aloud
 * (never arbitrary text from the browser), so the cost is bounded by what the product itself says.
 */
export interface SpeechResult {
  /** Base64 of raw 16-bit little-endian PCM, mono. */
  audio: string;
  sampleRate: number;
}

export interface SpeechProvider {
  readonly available: boolean;
  readonly name: string;
  synthesize(text: string, options: { signal: AbortSignal }): Promise<SpeechResult>;
}

export const disabledSpeech: SpeechProvider = {
  available: false,
  name: 'disabled',
  async synthesize() {
    throw new ProviderError('disabled', 'Spoken replies are not configured on this server.');
  },
};

/** Speak at most this much (about 14 s of audio; synthesis takes roughly half the audio length, so long answers would mean a long silence): long answers are shortened at a sentence boundary. */
export const MAX_SPOKEN_CHARS = 220;
const MAX_AUDIO_BASE64_CHARS = 6_000_000;

/** Plain text for a voice: no markdown noise, no bracketed asides, bounded length. */
export function speakableText(raw: string): string {
  const text = raw
    .replace(/\([^)]*unavailable right now[^)]*\)/gi, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_SPOKEN_CHARS) return text;
  const cut = text.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

export interface GeminiSpeechOptions {
  apiKey: string;
  /** Tried in order: the next one is used when a model is over quota (429), down (5xx) or unknown (404). */
  models: string[];
  voice: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Gemini text-to-speech over plain `fetch`: the key only in a header, redirects refused, errors never carry it. */
export function createGeminiSpeech(options: GeminiSpeechOptions): SpeechProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const provider: SpeechProvider = {
    available: true,
    name: 'gemini-tts',
    async synthesize(text, { signal }) {
      let failure: ProviderError | undefined;
      for (const model of options.models) {
        try {
          return await synthesizeWith(model, text, signal);
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          failure = error;
          const next = error.kind === 'rate_limited' || error.kind === 'unavailable' || (error.kind === 'auth' && error.detail === 'http 404');
          if (!next || signal.aborted) throw error;
        }
      }
      throw failure ?? new ProviderError('unavailable', 'No speech model is configured.');
    },
  };
  return provider;

  async function synthesizeWith(model: string, text: string, signal: AbortSignal): Promise<SpeechResult> {
    {
      let response: Response;
      try {
        response = await doFetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': options.apiKey, 'content-type': 'application/json' },
          redirect: 'error',
          signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } } },
          }),
        });
      } catch (error) {
        if (signal.aborted || (error as { name?: string }).name === 'AbortError') throw new ProviderError('timeout', 'Speech took too long.');
        throw new ProviderError('unavailable', 'Could not reach the speech service.');
      }
      if (!response.ok) {
        const status = response.status;
        throw new ProviderError(status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : status === 401 || status === 403 || status === 404 ? 'auth' : 'rejected', 'The speech service refused the request.', `http ${status}`);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new ProviderError('bad_output', 'The speech service answered in an unexpected format.');
      }
      const candidates = isRecord(json) && Array.isArray(json['candidates']) ? json['candidates'] : [];
      const parts = candidates.flatMap((c) => (isRecord(c) && isRecord(c['content']) && Array.isArray(c['content']['parts']) ? (c['content']['parts'] as unknown[]) : []));
      for (const part of parts) {
        const inline = isRecord(part) ? part['inlineData'] : undefined;
        if (!isRecord(inline) || typeof inline['data'] !== 'string' || inline['data'].length === 0) continue;
        if (inline['data'].length > MAX_AUDIO_BASE64_CHARS || !/^[A-Za-z0-9+/=]+$/.test(inline['data'])) throw new ProviderError('bad_output', 'The speech audio was not usable.');
        const rate = Number(/rate=(\d+)/.exec(typeof inline['mimeType'] === 'string' ? inline['mimeType'] : '')?.[1] ?? 24_000);
        return { audio: inline['data'], sampleRate: rate >= 8_000 && rate <= 48_000 ? rate : 24_000 };
      }
      throw new ProviderError('bad_output', 'The speech service returned no audio.');
    }
  }
}

/** Scripted speech for tests. */
export function createFakeSpeech(script: Array<SpeechResult | ProviderError> = [{ audio: 'AAAA', sampleRate: 24_000 }]): SpeechProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    available: true,
    name: 'fake-speech',
    calls,
    async synthesize(text) {
      const step = script[Math.min(calls.length, script.length - 1)]!;
      calls.push(text);
      if (step instanceof ProviderError) throw step;
      return step;
    },
  };
}
