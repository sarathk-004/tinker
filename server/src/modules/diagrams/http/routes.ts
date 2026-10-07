import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  API_PREFIX,
  aiAskRequestSchema,
  aiCommandRequestSchema,
  commandRequestSchema,
  createDiagramRequestSchema,
  createWorkspaceRequestSchema,
  diagramCommandSchema,
  expectedVersionQuerySchema,
  idempotencyKeySchema,
  presentationPatchRequestSchema,
  putAiKeyRequestSchema,
  renameDiagramRequestSchema,
  restoreRequestSchema,
  revisionListQuerySchema,
  speakRequestSchema,
  uuidSchema,
  versionSchema,
  type MeResponse,
} from '@tinker/shared';
import type { Authenticator } from '../../../infrastructure/auth/authenticator.ts';
import type { Pool } from '../../../infrastructure/database/pool.ts';
import { AppError, parseOrThrow } from '../../../infrastructure/http/errors.ts';
import type { RateLimiter } from '../../../infrastructure/http/rate-limiter.ts';
import type { RunResult, TestHooks } from '../../../infrastructure/idempotency/mutation-requests.ts';
import { listWorkspaces } from '../../workspaces/access.ts';
import { createWorkspace } from '../../workspaces/workspace-service.ts';
import { askAdvice } from '../../ai/application/advice-service.ts';
import { getRevisionDetail, listRevisions, restoreRevision } from '../../history/application/history-service.ts';
import { speakMessage } from '../../voice/speak-service.ts';
import { executeAiCommand, loadConversation, type AiRuntime } from '../../ai/application/ai-service.ts';
import {
  createDiagram,
  deleteDiagram,
  executeCommand,
  listDiagrams,
  loadDiagram,
  patchPresentation,
  presentOutcome,
  renameDiagram,
  type Actor,
  type ServiceDeps,
} from '../application/diagram-service.ts';

export interface ApiDeps {
  pool?: Pool;
  authenticate: Authenticator;
  rateLimiter: RateLimiter;
  hooks?: TestHooks;
  /** AI gateway, limits and deadline. Always present; `ai.provider.available` says whether a model is configured. */
  ai: AiRuntime;
  /** Limits how often one person may submit a key to be checked (5 a minute). */
  keyWriteLimiter: RateLimiter;
}

const diagramParams = z.object({ diagramId: uuidSchema });
const workspaceParams = z.object({ workspaceId: uuidSchema });
const commandEnvelopeSchema = z.object({ expectedVersion: versionSchema, command: z.unknown() });

function actorOf(request: FastifyRequest): Actor {
  const auth = request.auth;
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Authentication is required.'); // unreachable: hook always sets it
  return { userId: auth.userId, requestId: request.id };
}

function idempotencyKeyOf(request: FastifyRequest): string {
  return parseOrThrow(idempotencyKeySchema, request.headers['idempotency-key'], 'INVALID_REQUEST', 'A valid Idempotency-Key header is required.');
}

function send(reply: FastifyReply, request: FastifyRequest, result: RunResult) {
  const outcome = presentOutcome(result, request.id);
  if (result.replayed) reply.header('idempotent-replayed', 'true');
  return reply.status(outcome.status).send(outcome.body);
}

/**
 * Order on every protected route (LLD sections 17/18): authenticate (hook) -> rate limit (hook) -> request shape
 * (params, headers, body schema; reveals nothing about stored data) -> authorise against the database ->
 * idempotency reservation -> version/domain checks and atomic commit.
 */
export async function registerApiRoutes(root: FastifyInstance, deps: ApiDeps): Promise<void> {
  await root.register(async (app) => {
    app.addHook('onRequest', async (request) => {
      if (!request.url.startsWith(`${API_PREFIX}/`)) return;
      request.auth = await deps.authenticate(request);
      deps.rateLimiter.check(request.auth.userId);
    });

    const pool = deps.pool;
    if (!pool) {
      // No database configured: authenticated callers get a clear 503, everyone else 401.
      app.all(`${API_PREFIX}/*`, async () => {
        throw new AppError('SERVICE_UNAVAILABLE', 'The database is not configured.');
      });
      return;
    }
    const svc: ServiceDeps = { pool, ...(deps.hooks ? { hooks: deps.hooks } : {}) };

    /** What this person's AI can do right now depends on whose key their requests run on. */
    const featuresFor = async (userId: string): Promise<MeResponse['features']> => {
      const access = await deps.ai.access.providersFor(userId);
      return {
        aiCommands: true,
        aiModel: access.provider.available,
        voice: access.live.available,
        speech: access.speech.available,
        aiKey: { mode: deps.ai.access.mode, source: access.source },
      };
    };

    // Bring-your-own-key. The key is accepted once (PUT), checked with the provider, stored encrypted, and never returned.
    const keyWriteLimiter = deps.keyWriteLimiter;
    app.get(`${API_PREFIX}/me/ai-key`, async (request) => deps.ai.access.status(request.auth!.userId));
    app.put(`${API_PREFIX}/me/ai-key`, async (request) => {
      const body = parseOrThrow(putAiKeyRequestSchema, request.body, 'INVALID_REQUEST', 'That does not look like a complete API key.');
      keyWriteLimiter.check(request.auth!.userId); // guessing keys through us is not a thing
      return deps.ai.access.save(request.auth!.userId, body.apiKey);
    });
    app.delete(`${API_PREFIX}/me/ai-key`, async (request) => deps.ai.access.remove(request.auth!.userId));

    app.get(`${API_PREFIX}/me`, async (request): Promise<MeResponse> => {
      const auth = request.auth!;
      return {
        user: { id: auth.userId, email: auth.email, displayName: auth.displayName },
        workspaces: await listWorkspaces(pool, auth.userId),
        features: await featuresFor(auth.userId),
        quota: await deps.ai.usage.snapshot(auth.userId),
      };
    });

    app.get(`${API_PREFIX}/workspaces`, async (request) => ({ workspaces: await listWorkspaces(pool, request.auth!.userId) }));

    app.post(`${API_PREFIX}/workspaces`, async (request, reply) => {
      const key = idempotencyKeyOf(request);
      const body = parseOrThrow(createWorkspaceRequestSchema, request.body, 'INVALID_REQUEST', 'Give the workspace a name (1 to 80 characters).');
      return send(reply, request, await createWorkspace(svc, actorOf(request), key, body));
    });

    app.get(`${API_PREFIX}/workspaces/:workspaceId/diagrams`, async (request) => {
      const { workspaceId } = parseOrThrow(workspaceParams, request.params, 'INVALID_REQUEST', 'Invalid workspace id.');
      return listDiagrams(svc, actorOf(request), workspaceId);
    });

    app.post(`${API_PREFIX}/workspaces/:workspaceId/diagrams`, async (request, reply) => {
      const { workspaceId } = parseOrThrow(workspaceParams, request.params, 'INVALID_REQUEST', 'Invalid workspace id.');
      const key = idempotencyKeyOf(request);
      const body = parseOrThrow(createDiagramRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid diagram.');
      return send(reply, request, await createDiagram(svc, actorOf(request), workspaceId, key, body));
    });

    app.get(`${API_PREFIX}/diagrams/:diagramId`, async (request) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      return loadDiagram(svc, actorOf(request), diagramId);
    });

    app.patch(`${API_PREFIX}/diagrams/:diagramId`, async (request, reply) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const key = idempotencyKeyOf(request);
      const body = parseOrThrow(renameDiagramRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid rename request.');
      return send(reply, request, await renameDiagram(svc, actorOf(request), diagramId, key, body));
    });

    app.delete(`${API_PREFIX}/diagrams/:diagramId`, async (request, reply) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const key = idempotencyKeyOf(request);
      const query = parseOrThrow(expectedVersionQuerySchema, request.query, 'INVALID_REQUEST', 'expectedVersion query parameter is required.');
      return send(reply, request, await deleteDiagram(svc, actorOf(request), diagramId, key, query));
    });

    app.post(`${API_PREFIX}/diagrams/:diagramId/commands`, async (request, reply) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const key = idempotencyKeyOf(request);
      const envelope = parseOrThrow(commandEnvelopeSchema, request.body, 'INVALID_REQUEST', 'Invalid command request.');
      parseOrThrow(diagramCommandSchema, envelope.command, 'INVALID_COMMAND', 'Invalid command.');
      const body = parseOrThrow(commandRequestSchema, envelope, 'INVALID_COMMAND', 'Invalid command.');
      return send(reply, request, await executeCommand(svc, actorOf(request), diagramId, key, body));
    });

    app.post(`${API_PREFIX}/diagrams/:diagramId/ai/command`, async (request, reply) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const key = idempotencyKeyOf(request);
      const body = parseOrThrow(aiCommandRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid AI command request.');
      const aiDeps = { ...svc, ai: deps.ai, log: (message: string, data: Record<string, unknown>) => request.log.warn(data, message), metric: (message: string, data: Record<string, unknown>) => request.log.info(data, message) };
      return send(reply, request, await executeAiCommand(aiDeps, actorOf(request), diagramId, key, body));
    });

    // Read-only advice: no idempotency key (nothing is mutated), view access is enough.
    app.post(`${API_PREFIX}/diagrams/:diagramId/ai/ask`, async (request) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const body = parseOrThrow(aiAskRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid question.');
      const aiDeps = { ...svc, ai: deps.ai, log: (message: string, data: Record<string, unknown>) => request.log.warn(data, message), metric: (message: string, data: Record<string, unknown>) => request.log.info(data, message) };
      return askAdvice(aiDeps, actorOf(request), diagramId, body);
    });

    // History (D11): listing needs view access; restoring is an ordinary idempotent, version-checked write.
    app.get(`${API_PREFIX}/diagrams/:diagramId/revisions`, async (request) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const query = parseOrThrow(revisionListQuerySchema, request.query, 'INVALID_REQUEST', 'Invalid history query.');
      return listRevisions(svc, actorOf(request), diagramId, query);
    });

    app.get(`${API_PREFIX}/diagrams/:diagramId/revisions/:version`, async (request) => {
      const { diagramId, version } = parseOrThrow(z.object({ diagramId: uuidSchema, version: z.coerce.number().int().min(1) }), request.params, 'INVALID_REQUEST', 'Invalid revision.');
      return getRevisionDetail(svc, actorOf(request), diagramId, version);
    });

    app.post(`${API_PREFIX}/diagrams/:diagramId/restore`, async (request, reply) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const key = idempotencyKeyOf(request);
      const body = parseOrThrow(restoreRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid restore request.');
      return send(reply, request, await restoreRevision(svc, actorOf(request), diagramId, key, body));
    });

    // Read an assistant message aloud: view access, no idempotency key (nothing is mutated).
    app.post(`${API_PREFIX}/diagrams/:diagramId/ai/speak`, async (request) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const body = parseOrThrow(speakRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid request.');
      const aiDeps = { ...svc, ai: deps.ai, log: (message: string, data: Record<string, unknown>) => request.log.warn(data, message), metric: (message: string, data: Record<string, unknown>) => request.log.info(data, message) };
      return speakMessage(aiDeps, actorOf(request), diagramId, body);
    });

    app.get(`${API_PREFIX}/diagrams/:diagramId/conversation`, async (request) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      return loadConversation(svc, actorOf(request), diagramId);
    });

    app.patch(`${API_PREFIX}/diagrams/:diagramId/presentation`, async (request, reply) => {
      const { diagramId } = parseOrThrow(diagramParams, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
      const key = idempotencyKeyOf(request);
      const body = parseOrThrow(presentationPatchRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid presentation update.');
      return send(reply, request, await patchPresentation(svc, actorOf(request), diagramId, key, body));
    });
  });
}
