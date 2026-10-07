import { randomUUID } from 'node:crypto';
import type { AiAppliedResponse, AiCommandRequest, AiCommandResponse, ChatMessage, ConversationResponse } from '@tinker/shared';
import type { PoolClient } from '../../../infrastructure/database/pool.ts';
import { AppError } from '../../../infrastructure/http/errors.ts';
import type { ConcurrencyLimiter } from '../../../infrastructure/http/concurrency-limiter.ts';
import type { RateLimiter } from '../../../infrastructure/http/rate-limiter.ts';
import { runIdempotentPrepared, type ClassifyFailure, type Finish, type RunResult } from '../../../infrastructure/idempotency/mutation-requests.ts';
import { authorizeDiagram } from '../../workspaces/access.ts';
import { failure, versionConflict, type Actor, type ServiceDeps } from '../../diagrams/application/diagram-service.ts';
import { getDiagramRow, insertPlanExecution, insertRevision, lockDiagramRow, updateDocument } from '../../diagrams/persistence/diagrams.ts';
import { buildAliases, executePlan, type PlanStep } from '../domain/plan.ts';
import { appendMessages, conversationBelongsTo, createConversation, latestConversation, recentTurns } from '../persistence/conversations.ts';
import { ProviderError } from '../providers/types.ts';
import type { AiAccess } from '../../ai-keys/ai-access.ts';
import type { DailyUsage } from '../../usage/daily-usage.ts';
import { interpretRequest, type AiSource } from './interpret.ts';

export interface AiRuntime {
  /** Whose model key each person's requests run on (their own, the server's, or none) and how a person manages their own key. */
  access: AiAccess;
  /** Total interpretation budget, including provider retries (D07). */
  deadlineMs: number;
  /** Model name, for latency metrics only. */
  model?: string;
  /** Per-user AI requests per minute (D10, single instance). */
  limiter: RateLimiter;
  /** Per-user simultaneous AI requests (D10, single instance). */
  concurrency: ConcurrencyLimiter;
  /** Daily allowance per person and for the whole service (spend cap). */
  usage: DailyUsage;
}

export interface AiDeps extends ServiceDeps {
  ai: AiRuntime;
  /** Server-side diagnostics for provider failures (never user text, never the key). */
  log?: (message: string, data: Record<string, unknown>) => void;
  /** Latency metrics at info level: one structured line per provider attempt. */
  metric?: (message: string, data: Record<string, unknown>) => void;
}

const HISTORY_TURNS = 8;
const FRIENDLY = "Couldn't interpret that command. Your diagram hasn't changed.";

/** Provider failures become contract errors; transient ones keep the key for bounded same-key retries (D03). */
function classify(deps: AiDeps): ClassifyFailure {
  return (error) => {
    if (!(error instanceof ProviderError)) return null;
    deps.log?.('ai provider failure', { kind: error.kind, detail: error.detail });
    switch (error.kind) {
      case 'timeout':
        return { retryable: true, error: new AppError('AI_TIMEOUT', FRIENDLY) };
      case 'unavailable':
      case 'bad_output':
        return { retryable: true, error: new AppError('AI_PROVIDER_ERROR', FRIENDLY) };
      case 'rate_limited':
        return { retryable: true, error: new AppError('AI_UNAVAILABLE', "AI is busy right now. Please try again in a moment. Your diagram hasn't changed.") };
      case 'rejected':
        return { retryable: false, error: new AppError('AI_PROVIDER_ERROR', FRIENDLY) };
      case 'auth':
      case 'disabled':
        return { retryable: false, error: new AppError('AI_UNAVAILABLE', 'AI commands are not available right now. You can keep editing manually.') };
    }
  };
}

export async function persistTurn(
  tx: PoolClient,
  input: { conversationId: string | undefined; diagramId: string; userId: string; userText: string; assistantText: string; metadata: Record<string, unknown> },
): Promise<{ conversationId: string; messages: ChatMessage[] }> {
  const conversationId = input.conversationId ?? (await createConversation(tx, input.diagramId, input.userId));
  const messages = await appendMessages(tx, conversationId, [
    { role: 'USER', content: input.userText },
    { role: 'ASSISTANT', content: input.assistantText, metadata: input.metadata },
  ]);
  return { conversationId, messages };
}

/**
 * POST /v1/diagrams/{id}/ai/command. Typed text becomes ONE atomic edit through the same transaction as manual edits.
 *
 *  authorize -> (idempotency reservation) -> load -> interpret OUTSIDE any transaction under a hard deadline ->
 *  dry-run the plan on the loaded version -> ONE transaction: re-authorise, version must still match, apply, revision,
 *  execution record, conversation turn, stored response.
 * The interpretation is bound to `expectedVersion`: if the diagram moved while the provider thought, nothing is applied.
 */
export async function executeAiCommand(deps: AiDeps, actor: Actor, diagramId: string, key: string, request: AiCommandRequest): Promise<RunResult> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'modify');
  if (request.conversationId && !(await conversationBelongsTo(deps.pool, request.conversationId, diagramId, actor.userId))) {
    throw new AppError('NOT_FOUND', 'Conversation not found.');
  }
  const newId = deps.newId ?? randomUUID;
  const text = request.input.text;

  const prepare = async (): Promise<Finish> => {
    // The per-user AI limits are enforced inside interpretRequest, and only when the MODEL is needed: plain commands the parser
    // understands cost no quota. A 429 there releases the key (a refused-for-load request is not cached).
    {
      const current = await getDiagramRow(deps.pool, diagramId);
      if (!current) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
      // Cheap early exit: a stale request never spends provider budget.
      if (current.version !== request.expectedVersion) return async () => versionConflict(actor, request.expectedVersion, current.version);

      const doc = { graph: current.graph, presentation: current.presentation };
      const history = request.conversationId ? await recentTurns(deps.pool, request.conversationId, HISTORY_TURNS) : [];
      const interpretation = await interpretRequest({ doc, text, history, resolveProvider: async () => (await deps.ai.access.providersFor(actor.userId)).provider,
        deadlineMs: deps.ai.deadlineMs,
        beforeProvider: async () => {
          deps.ai.limiter.check(actor.userId);
          const release = deps.ai.concurrency.acquire(actor.userId);
          try {
            await deps.ai.usage.consume(actor.userId, 'AI'); // the daily allowance: counted only now, when the model is really needed
          } catch (error) {
            release();
            throw error;
          }
          return release;
        },
        onAttempt: (a) => deps.metric?.('ai provider attempt', { ...a, model: deps.ai.model, deadlineMs: deps.ai.deadlineMs }),
      });

      if (interpretation.kind === 'clarify') return clarification(interpretation.source, interpretation.question, interpretation.options, current.version);

      const dry = executePlan(doc, interpretation.steps, buildAliases(doc), newId);
      if (!dry.ok && dry.kind === 'CLARIFY') return clarification(interpretation.source, dry.question, dry.options, current.version);
      if (!dry.ok) return refusal(interpretation.source, dry.error.message, { reason: dry.error.reason, stepIndex: dry.stepIndex, ...dry.error.details });
      return commit(interpretation.source, interpretation.steps);
    }
  };

  const clarification =
    (source: AiSource, question: string, options: string[], version: number): Finish =>
    async (tx) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'modify');
      const turn = await persistTurn(tx, { conversationId: request.conversationId, diagramId, userId: actor.userId, userText: text, assistantText: question, metadata: { source, status: 'CLARIFICATION', diagramVersion: version, options } });
      const body: AiCommandResponse = { status: 'CLARIFICATION', source, question, options: options.slice(0, 6), conversationId: turn.conversationId, messages: turn.messages, diagram: { id: diagramId, version } };
      return { status: 200, body };
    };

  const refusal =
    (source: AiSource, message: string, details: Record<string, unknown>): Finish =>
    async (tx) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'modify');
      await persistTurn(tx, { conversationId: request.conversationId, diagramId, userId: actor.userId, userText: text, assistantText: message, metadata: { source, status: 'REFUSED' } });
      return failure(actor.requestId, 'DOMAIN_VALIDATION_FAILED', message, details);
    };

  const commit =
    (source: AiSource, steps: PlanStep[]): Finish =>
    async (tx, mutationRequestId) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'modify'); // access may have been revoked while we interpreted
      const locked = await lockDiagramRow(tx, diagramId);
      if (!locked) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
      // Bound to the captured version: if anything changed while the provider thought, apply NOTHING.
      if (locked.version !== request.expectedVersion) return versionConflict(actor, request.expectedVersion, locked.version);

      const doc = { graph: locked.graph, presentation: locked.presentation };
      const planned = executePlan(doc, steps, buildAliases(doc), newId);
      if (!planned.ok) {
        const message = planned.kind === 'CLARIFY' ? planned.question : planned.error.message;
        await persistTurn(tx, { conversationId: request.conversationId, diagramId, userId: actor.userId, userText: text, assistantText: message, metadata: { source, status: 'REFUSED' } });
        return failure(actor.requestId, 'DOMAIN_VALIDATION_FAILED', message, planned.kind === 'REFUSED' ? { reason: planned.error.reason, stepIndex: planned.stepIndex } : {});
      }

      const updated = await updateDocument(tx, { id: diagramId, expectedVersion: request.expectedVersion, graph: planned.doc.graph, presentation: planned.doc.presentation });
      if (!updated) throw new Error('conditional update affected no rows while holding the row lock');
      await deps.hooks?.fault?.('after-diagram-update');
      await insertRevision(tx, { diagramId, version: updated.version, graph: updated.graph, presentation: updated.presentation, reason: 'AI_COMMAND', createdBy: actor.userId });
      await deps.hooks?.fault?.('after-revision');
      const executionId = await insertPlanExecution(tx, { mutationRequestId, diagramId, actorId: actor.userId, source, commands: planned.commands, expectedVersion: request.expectedVersion, resultVersion: updated.version });

      const turn = await persistTurn(tx, {
        conversationId: request.conversationId,
        diagramId,
        userId: actor.userId,
        userText: text,
        assistantText: `${planned.summaries.map((s) => s.summary).join('. ')}.`,
        metadata: { source, status: 'APPLIED', commandExecutionId: executionId, diagramVersion: updated.version },
      });
      const body: AiAppliedResponse = {
        status: 'APPLIED',
        source,
        interpretation: { commands: planned.summaries },
        conversationId: turn.conversationId,
        messages: turn.messages,
        diagram: { id: diagramId, version: updated.version, graph: updated.graph, presentation: updated.presentation },
      };
      return { status: 200, body };
    };

  return runIdempotentPrepared(
    deps.pool,
    { actorId: actor.userId, key, method: 'POST', resource: `/v1/diagrams/${diagramId}/ai/command`, body: request, diagramId },
    prepare,
    deps.hooks,
    classify(deps),
  );
}

/** GET /v1/diagrams/{id}/conversation: the caller's latest conversation for this diagram. */
export async function loadConversation(deps: ServiceDeps, actor: Actor, diagramId: string): Promise<ConversationResponse> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'view');
  return latestConversation(deps.pool, diagramId, actor.userId);
}
