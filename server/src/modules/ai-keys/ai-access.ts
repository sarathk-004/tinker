import type { AiKeyMode, AiKeySource, AiKeyStatus } from '@tinker/shared';
import type { Pool } from '../../infrastructure/database/pool.ts';
import { AppError } from '../../infrastructure/http/errors.ts';
import { SecretBoxError, type SecretBox } from '../../infrastructure/crypto/secret-box.ts';
import { createGeminiProvider } from '../ai/providers/gemini.ts';
import { disabledProvider } from '../ai/providers/fake.ts';
import type { InterpretationProvider } from '../ai/providers/types.ts';
import { createGeminiLiveGateway } from '../voice/gemini-live.ts';
import { disabledLiveGateway, type LiveGateway } from '../voice/live-gateway.ts';
import { createGeminiSpeech, disabledSpeech, type SpeechProvider } from '../voice/speech-provider.ts';
import { deleteStoredKey, getStoredKey, putStoredKey, touchStoredKey } from './user-keys.ts';

/** Everything model-related one person's requests may use. Built per request, so each request runs on the right key. */
export interface AiProviders {
  provider: InterpretationProvider;
  live: LiveGateway;
  speech: SpeechProvider;
  source: AiKeySource;
}

export const NO_AI: AiProviders = { provider: disabledProvider, live: disabledLiveGateway, speech: disabledSpeech, source: 'NONE' };

export type KeyCheck = 'valid' | 'invalid' | 'unavailable';

/** Ask Google whether an API key is accepted, with a request that costs nothing (listing one model). The key goes only in a header. */
export async function checkGeminiKey(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8_000): Promise<KeyCheck> {
  try {
    const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return 'valid';
    // 400 API_KEY_INVALID, 401, 403 (restricted or disabled): the key itself is the problem. 429 and 5xx are not the person's fault.
    return res.status === 400 || res.status === 401 || res.status === 403 ? 'invalid' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export interface AiAccessOptions {
  pool: Pool;
  mode: AiKeyMode;
  /** Required unless mode is `server`. */
  secretBox: SecretBox | undefined;
  /** The operator's own providers (used in `server` and `user_or_server` modes). */
  server: Omit<AiProviders, 'source'> & { configured: boolean };
  models: { chat: string; thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high'; live: string; tts: string[]; ttsVoice: string };
  /** Tests inject a fake check and fake provider factories. */
  checkKey?: (apiKey: string) => Promise<KeyCheck>;
  build?: (apiKey: string) => Omit<AiProviders, 'source'>;
  log?: (message: string, data: Record<string, unknown>) => void;
}

export interface AiAccess {
  readonly mode: AiKeyMode;
  providersFor(userId: string): Promise<AiProviders>;
  status(userId: string): Promise<AiKeyStatus>;
  save(userId: string, apiKey: string): Promise<AiKeyStatus>;
  remove(userId: string): Promise<AiKeyStatus>;
}

/** Access without a database (no personal keys possible): everyone runs on the server's providers, if it has any. */
export function serverOnlyAccess(server: AiAccessOptions['server']): AiAccess {
  const providers: AiProviders = server.configured ? { provider: server.provider, live: server.live, speech: server.speech, source: 'SERVER' } : NO_AI;
  const status: AiKeyStatus = { mode: 'server', source: providers.source, configured: false, last4: null, addedAt: null, verifiedAt: null };
  return {
    mode: 'server',
    providersFor: async () => providers,
    status: async () => status,
    save: async () => {
      throw new AppError('NOT_FOUND', 'This server does not use personal API keys.');
    },
    remove: async () => {
      throw new AppError('NOT_FOUND', 'This server does not use personal API keys.');
    },
  };
}

const aadFor = (userId: string) => `${userId}:gemini`;
const last4 = (key: string) => key.slice(-4);

/**
 * Decides, per person, which model key their AI requests run on, and manages the person's own key.
 * The key is checked with the provider before it is stored, sealed with the server's master key before it touches the database,
 * and decrypted only in memory for the request that needs it. Nothing here ever logs, returns or throws the key.
 */
export function createAiAccess(options: AiAccessOptions): AiAccess {
  const { pool, mode, secretBox, server } = options;
  const check = options.checkKey ?? ((key: string) => checkGeminiKey(key));
  const build =
    options.build ??
    ((apiKey: string) => ({
      provider: createGeminiProvider({ apiKey, model: options.models.chat, thinkingLevel: options.models.thinkingLevel }),
      live: createGeminiLiveGateway({ apiKey, model: options.models.live }),
      speech: createGeminiSpeech({ apiKey, models: options.models.tts, voice: options.models.ttsVoice }),
    }));

  const serverProviders = (): AiProviders => (server.configured ? { provider: server.provider, live: server.live, speech: server.speech, source: 'SERVER' } : NO_AI);

  /** The person's own key in plaintext, or null (none stored, or it cannot be opened: logged without the key). */
  async function userKey(userId: string): Promise<string | null> {
    if (mode === 'server' || !secretBox) return null;
    const stored = await getStoredKey(pool, userId);
    if (!stored) return null;
    try {
      const key = secretBox.open(stored.sealed, aadFor(userId));
      void touchStoredKey(pool, userId).catch(() => undefined);
      return key;
    } catch (error) {
      options.log?.('stored api key unusable', { reason: error instanceof SecretBoxError ? error.reason : 'unknown' });
      return null;
    }
  }

  async function sourceFor(userId: string): Promise<{ source: AiKeySource; key: string | null }> {
    if (mode === 'server') return { source: server.configured ? 'SERVER' : 'NONE', key: null };
    const key = await userKey(userId);
    if (key) return { source: 'USER', key };
    if (mode === 'user_or_server' && server.configured) return { source: 'SERVER', key: null };
    return { source: 'NONE', key: null };
  }

  async function status(userId: string): Promise<AiKeyStatus> {
    const stored = mode === 'server' ? null : await getStoredKey(pool, userId);
    const { source } = await sourceFor(userId);
    return {
      mode,
      source,
      configured: stored !== null,
      last4: stored?.last4 ?? null,
      addedAt: stored?.addedAt.toISOString() ?? null,
      verifiedAt: stored?.verifiedAt?.toISOString() ?? null,
    };
  }

  return {
    mode,
    status,

    async providersFor(userId) {
      const { source, key } = await sourceFor(userId);
      if (source === 'NONE') return NO_AI;
      if (source === 'SERVER') return serverProviders();
      return { ...build(key!), source: 'USER' };
    },

    async save(userId, apiKey) {
      if (mode === 'server' || !secretBox) throw new AppError('NOT_FOUND', 'This server does not use personal API keys.');
      const verdict = await check(apiKey);
      if (verdict === 'invalid') {
        throw new AppError('DOMAIN_VALIDATION_FAILED', 'Google did not accept that key. Check that you copied the whole key from Google AI Studio and that it is enabled.', { reason: 'API_KEY_INVALID' });
      }
      if (verdict === 'unavailable') throw new AppError('SERVICE_UNAVAILABLE', 'Could not reach Google to check the key just now. Please try again in a moment. Nothing was saved.');
      await putStoredKey(pool, { userId, sealed: secretBox.seal(apiKey, aadFor(userId)), last4: last4(apiKey) });
      return status(userId);
    },

    async remove(userId) {
      if (mode === 'server') throw new AppError('NOT_FOUND', 'This server does not use personal API keys.');
      await deleteStoredKey(pool, userId);
      return status(userId);
    },
  };
}
