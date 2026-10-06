import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { LIMITS, type HealthResponse } from '@tinker/shared';
import type { Config } from './infrastructure/config/config.ts';
import { createJwtAuthenticator, createTokenAuthenticator, rejectAllAuthenticator, type Authenticator } from './infrastructure/auth/authenticator.ts';
import type { LocalSigner, TokenVerifier } from './infrastructure/auth/verifier.ts';
import type { Pool } from './infrastructure/database/pool.ts';
import { createConcurrencyLimiter } from './infrastructure/http/concurrency-limiter.ts';
import { createRateLimiter, type RateLimiter } from './infrastructure/http/rate-limiter.ts';
import { createGeminiProvider } from './modules/ai/providers/gemini.ts';
import { disabledProvider } from './modules/ai/providers/fake.ts';
import type { InterpretationProvider } from './modules/ai/providers/types.ts';
import type { TestHooks } from './infrastructure/idempotency/mutation-requests.ts';
import { registerDevAuthRoutes } from './modules/identity/dev-auth-routes.ts';
import { AppError, toErrorResponse } from './infrastructure/http/errors.ts';
import { registerDevEngineRoutes } from './modules/diagrams/http/dev-routes.ts';
import { registerApiRoutes } from './modules/diagrams/http/routes.ts';
import { createGeminiLiveGateway } from './modules/voice/gemini-live.ts';
import { createGeminiSpeech, disabledSpeech, type SpeechProvider } from './modules/voice/speech-provider.ts';
import { disabledLiveGateway, type LiveGateway } from './modules/voice/live-gateway.ts';
import { registerVoiceRoutes } from './modules/voice/routes.ts';
import type { VoiceSessionLimits } from './modules/voice/voice-session.ts';

export interface BuildAppOptions {
  config: Config;
  /** Database pool. Without it protected routes answer 503 after authentication. */
  pool?: Pool;
  /** Verifies bearer tokens (Supabase JWKS or the local dev signer). Without one every protected route answers 401. */
  verifier?: TokenVerifier;
  /** Override authentication entirely (tests). */
  authenticate?: Authenticator;
  /** Present only in AUTH_MODE=dev: enables POST /dev/auth/login. */
  devSigner?: LocalSigner;
  rateLimiter?: RateLimiter;
  /** Override the AI provider (tests inject a deterministic fake). Defaults to Gemini when GEMINI_API_KEY is set, else disabled. */
  aiProvider?: InterpretationProvider;
  /** Override the realtime voice gateway (tests inject a scripted fake). Defaults to Gemini Live when GEMINI_API_KEY is set. */
  liveGateway?: LiveGateway;
  /** Override text to speech (tests). Defaults to Gemini TTS when GEMINI_API_KEY is set. */
  speechProvider?: SpeechProvider;
  /** Tests: shorter timers and smaller quotas for voice sessions. */
  voiceLimits?: Partial<VoiceSessionLimits>;
  /** Override the AI rate limiter (tests). */
  aiRateLimiter?: RateLimiter;
  /** Test-only: fault injection into the commit path and a short lease. */
  hooks?: TestHooks;
  /** Tests disable logging. */
  logger?: boolean;
  /** Tests: capture log lines instead of writing them to stdout. */
  logStream?: { write(line: string): void };
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({
    bodyLimit: LIMITS.maxRequestBodyBytes,
    // One structured `request` line per API call (below) replaces Fastify's two default lines, which print the full URL with ids.
    disableRequestLogging: true,
    genReqId: (req) => {
      const supplied = req.headers['x-request-id'];
      return typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    },
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["idempotency-key"]'],
            ...(options.logStream ? { stream: options.logStream } : {}),
          },
  });

  // Body-less requests (DELETE, or any client that always sends Content-Type: application/json) must not be rejected
  // for an empty body. Everything else keeps Fastify's hardened parser (prototype-poisoning protection, 400 on bad JSON).
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (typeof body === 'string' && body.trim() === '') return done(null, undefined);
    return parseJson(request, body as string, done);
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'idempotent-replayed', 'retry-after'],
    maxAge: 600,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    // Remember WHICH error code a failed API answer carried (conflict, rate limit, AI timeout...) for the request log below.
    if (reply.statusCode >= 400 && typeof payload === 'string' && payload.length < 4_096) {
      try {
        const code = (JSON.parse(payload) as { error?: { code?: unknown } }).error?.code;
        if (typeof code === 'string') request.errorCode = code;
      } catch {
        /* not JSON */
      }
    }
    return payload;
  });

  // One structured line per API request: route pattern (never the URL with ids), status, duration, and the error code.
  // `npm run log:report` turns these into latency percentiles, conflict and failure counts. No bodies, tokens or user text.
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url;
    if (!route || !route.startsWith('/v1/')) return;
    request.log.info({ msg: 'request', route, method: request.method, status: reply.statusCode, ms: Math.round(reply.elapsedTime * 10) / 10, ...(request.errorCode ? { code: request.errorCode } : {}) }, 'request');
  });

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorResponse(error, request.id);
    if (body.error.code === 'RATE_LIMITED') {
      const seconds = (body.error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (seconds) reply.header('retry-after', String(seconds));
    }
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    else request.log.info({ code: body.error.code }, 'request rejected');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const { status, body } = toErrorResponse(new AppError('NOT_FOUND', 'Route not found.'), request.id);
    return reply.status(status).send(body);
  });

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'tinker-api',
    time: new Date().toISOString(),
  }));

  // Readiness (separate from liveness, D10): can we reach the database?
  app.get('/health/ready', async () => {
    if (!options.pool) throw new AppError('SERVICE_UNAVAILABLE', 'The database is not configured.');
    try {
      await options.pool.query('SELECT 1');
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'The database is unreachable.');
    }
    return { status: 'ok' as const };
  });

  // Unauthenticated, stateless engine preview and dev login: development only, never in test or production.
  if (config.nodeEnv === 'development') {
    await registerDevEngineRoutes(app);
    if (options.devSigner && config.authMode === 'dev') await registerDevAuthRoutes(app, options.devSigner);
  }

  const authenticate =
    options.authenticate ??
    (options.pool && options.verifier ? createJwtAuthenticator(options.pool, options.verifier) : rejectAllAuthenticator);
  const ai = {
    provider: options.aiProvider ?? (config.ai.apiKey ? createGeminiProvider({ apiKey: config.ai.apiKey, model: config.ai.model, thinkingLevel: config.ai.thinkingLevel }) : disabledProvider),
    deadlineMs: config.ai.deadlineMs,
    model: config.ai.model,
    speech: options.speechProvider ?? (config.ai.apiKey ? createGeminiSpeech({ apiKey: config.ai.apiKey, models: config.ai.ttsModels, voice: config.ai.ttsVoice }) : disabledSpeech),
    limiter: options.aiRateLimiter ?? createRateLimiter({ limit: config.ai.ratePerMinute }),
    concurrency: createConcurrencyLimiter({ max: config.ai.maxConcurrent }),
  };
  const live = options.liveGateway ?? (config.ai.apiKey ? createGeminiLiveGateway({ apiKey: config.ai.apiKey, model: config.ai.liveModel }) : disabledLiveGateway);
  const rateLimiter = options.rateLimiter ?? createRateLimiter({ limit: config.rateLimitPerMinute });
  await registerApiRoutes(app, {
    ...(options.pool ? { pool: options.pool } : {}),
    authenticate,
    rateLimiter,
    ai,
    voiceAvailable: live.available,
    ...(options.hooks ? { hooks: options.hooks } : {}),
  });

  await registerVoiceRoutes(app, {
    pool: options.pool,
    authenticate: options.pool && options.verifier ? createTokenAuthenticator(options.pool, options.verifier) : undefined,
    ai,
    live,
    rateLimiter,
    corsOrigins: config.corsOrigins,
    maxSessions: config.voice.maxSessions,
    limits: { maxSessionMs: config.voice.maxSessionMs, ...options.voiceLimits },
    ...(options.hooks ? { hooks: options.hooks } : {}),
  });

  return app;
}
