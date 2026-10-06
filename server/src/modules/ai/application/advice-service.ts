import type { AiAskRequest, AiAskResponse } from '@tinker/shared';
import { withTransaction } from '../../../infrastructure/database/pool.ts';
import { AppError } from '../../../infrastructure/http/errors.ts';
import { authorizeDiagram } from '../../workspaces/access.ts';
import { getDiagramRow } from '../../diagrams/persistence/diagrams.ts';
import { conversationBelongsTo, recentTurns } from '../persistence/conversations.ts';
import { ProviderError } from '../providers/types.ts';
import { ADVICE_RESPONSE_JSON_SCHEMA, ADVICE_SYSTEM_INSTRUCTION, adviceOutputSchema, analyzeQuestion, buildAdvicePrompt, fallbackAnswer, resolveHighlights, tidyAdviceOutput } from './advice.ts';
import { persistTurn, type AiDeps } from './ai-service.ts';
import { runProvider } from './provider-call.ts';

const HISTORY_TURNS = 8;

/**
 * POST /v1/diagrams/{id}/ai/ask. Read-only advice: needs only `view` access and NEVER touches the diagram, its revisions or
 * its version. The one thing it stores is the question/answer turn in the caller's own conversation.
 *
 *  authorize -> rate limit -> load -> compute the facts (no model) -> model explains them under a hard deadline
 *  (any provider failure falls back to a computed answer) -> store the turn.
 */
export async function askAdvice(deps: AiDeps, actor: { userId: string }, diagramId: string, request: AiAskRequest): Promise<AiAskResponse> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'view');
  if (request.conversationId && !(await conversationBelongsTo(deps.pool, request.conversationId, diagramId, actor.userId))) {
    throw new AppError('NOT_FOUND', 'Conversation not found.');
  }
  deps.ai.limiter.check(actor.userId);
  const release = deps.ai.concurrency.acquire(actor.userId);
  try {
    const row = await getDiagramRow(deps.pool, diagramId);
    if (!row) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
    const doc = { graph: row.graph, presentation: row.presentation };
    const analysis = analyzeQuestion(doc, request.question);

    let answer: string | undefined;
    let source: AiAskResponse['source'] = 'ANALYZER';
    let modelHighlights: string[] = [];
    if (deps.ai.provider.available) {
      const history = request.conversationId ? await recentTurns(deps.pool, request.conversationId, HISTORY_TURNS) : [];
      const prompt = buildAdvicePrompt(doc, analysis, history, request.question);
      if (prompt.ok) {
        try {
          const out = await runProvider({
            provider: deps.ai.provider,
            request: { systemInstruction: ADVICE_SYSTEM_INSTRUCTION, content: prompt.content, responseSchema: ADVICE_RESPONSE_JSON_SCHEMA as unknown as Record<string, unknown> },
            deadlineMs: deps.ai.deadlineMs,
            onAttempt: (a) => deps.metric?.('ai provider attempt', { ...a, kind: 'ask', model: deps.ai.model, deadlineMs: deps.ai.deadlineMs }),
            parse: (output) => {
              const parsed = adviceOutputSchema.safeParse(tidyAdviceOutput(output));
              if (!parsed.success) throw new ProviderError('bad_output', 'The AI output did not match the expected format.', parsed.error.issues[0]?.message);
              return parsed.data;
            },
          });
          answer = out.answer;
          source = 'AI';
          modelHighlights = resolveHighlights(doc, out.highlight);
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          deps.log?.('ai provider failure', { kind: error.kind, detail: error.detail, during: 'ask' });
        }
      }
    }
    answer ??= fallbackAnswer(doc, analysis);

    const affectedNodeIds = [...new Set([...analysis.affectedNodeIds, ...modelHighlights])];
    const stored = await withTransaction(deps.pool, async (tx) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'view'); // access may have been revoked while we thought
      return persistTurn(tx, {
        conversationId: request.conversationId,
        diagramId,
        userId: actor.userId,
        userText: request.question,
        assistantText: answer,
        metadata: { source, status: 'ADVICE', diagramVersion: row.version, highlight: affectedNodeIds },
      });
    });
    return {
      answer,
      source,
      analysis: { ...analysis, affectedNodeIds },
      conversationId: stored.conversationId,
      messages: stored.messages,
      diagram: { id: diagramId, version: row.version },
    };
  } finally {
    release();
  }
}
