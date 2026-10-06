import type { SpeakRequest, SpeakResponse } from '@tinker/shared';
import { AppError } from '../../infrastructure/http/errors.ts';
import type { AiDeps } from '../ai/application/ai-service.ts';
import { assistantMessageText } from '../ai/persistence/conversations.ts';
import { ProviderError } from '../ai/providers/types.ts';
import { authorizeDiagram } from '../workspaces/access.ts';
import { speakableText } from './speech-provider.ts';

/**
 * POST /v1/diagrams/{id}/ai/speak. Reads one of the caller's own assistant messages aloud with the speech provider. Read-only:
 * needs `view` access, stores nothing, and the browser can only name a message id (never supply text), so this cannot be used
 * as a general text-to-speech service. One synthesis under the AI deadline, no retry: the browser has its own voice as fallback.
 */
export async function speakMessage(deps: AiDeps, actor: { userId: string }, diagramId: string, request: SpeakRequest): Promise<SpeakResponse> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'view');
  if (!deps.ai.speech.available) throw new AppError('AI_UNAVAILABLE', 'Spoken replies are not available right now.');
  const stored = await assistantMessageText(deps.pool, request.messageId, diagramId, actor.userId);
  if (stored === null) throw new AppError('NOT_FOUND', 'Message not found.');
  const text = speakableText(stored);
  if (!text) throw new AppError('INVALID_REQUEST', 'There is nothing to read aloud.');

  // Bounded by the ordinary per-user request limit, the AI concurrency cap and the text cap (not the 10/min AI limit, which asking uses).
  const release = deps.ai.concurrency.acquire(actor.userId);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.ai.deadlineMs);
  try {
    const speech = await deps.ai.speech.synthesize(text, { signal: controller.signal });
    deps.metric?.('speech synthesized', { ms: Date.now() - started, chars: text.length, model: deps.ai.speech.name });
    return { audio: speech.audio, sampleRate: speech.sampleRate, format: 'pcm_s16le' };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    deps.log?.('speech failure', { kind: error.kind, detail: error.detail });
    throw new AppError(error.kind === 'timeout' ? 'AI_TIMEOUT' : error.kind === 'rate_limited' ? 'AI_UNAVAILABLE' : 'AI_PROVIDER_ERROR', 'Could not read that aloud.');
  } finally {
    clearTimeout(timer);
    release();
  }
}
