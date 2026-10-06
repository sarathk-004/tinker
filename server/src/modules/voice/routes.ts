import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { VOICE_AUDIO, VOICE_CLOSE, VOICE_LIMITS, VOICE_PATH } from '@tinker/shared';
import { decodeJwt } from 'jose';
import type { TokenAuthenticator } from '../../infrastructure/auth/authenticator.ts';
import type { Pool } from '../../infrastructure/database/pool.ts';
import type { RateLimiter } from '../../infrastructure/http/rate-limiter.ts';
import type { AiRuntime } from '../ai/application/ai-service.ts';
import type { TestHooks } from '../../infrastructure/idempotency/mutation-requests.ts';
import type { LiveGateway } from './live-gateway.ts';
import { DEFAULT_VOICE_LIMITS, VoiceSession, createVoiceRegistry, type VoiceSessionLimits } from './voice-session.ts';

export interface VoiceRouteDeps {
  pool: Pool | undefined;
  /** Without a verifier/pool sessions are refused with UNAVAILABLE. */
  authenticate: TokenAuthenticator | undefined;
  ai: AiRuntime;
  /** Resolves the realtime speech gateway for one person (their own key, or the server's). */
  liveFor: (userId: string) => Promise<LiveGateway>;
  rateLimiter: RateLimiter;
  corsOrigins: string[];
  maxSessions: number;
  limits?: Partial<VoiceSessionLimits>;
  hooks?: TestHooks;
}

const tokenExpiry = (token: string): number | null => {
  try {
    const exp = decodeJwt(token).exp; // the token was verified by `authenticate` before this is used
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
};

/**
 * GET /v1/voice (WebSocket). Outside the REST scope on purpose: browsers cannot set an Authorization header on a WebSocket, so
 * authentication is the first message (see shared/src/voice.ts). The Origin header must be an allowed origin.
 */
export async function registerVoiceRoutes(root: FastifyInstance, deps: VoiceRouteDeps): Promise<void> {
  const limits: VoiceSessionLimits = { ...DEFAULT_VOICE_LIMITS, ...deps.limits };
  const registry = createVoiceRegistry(deps.maxSessions);

  {
    const app = root;
    await app.register(websocket, { options: { maxPayload: Math.max(VOICE_AUDIO.maxChunkBytes, VOICE_LIMITS.maxTextFrameBytes) + 64 } });

    app.get(
      VOICE_PATH,
      {
        websocket: true,
        onRequest: async (request, reply) => {
          const origin = request.headers.origin;
          if (typeof origin !== 'string' || !deps.corsOrigins.includes(origin)) {
            return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Origin not allowed.', requestId: request.id } });
          }
        },
      },
      (socket, request) => {
        const refuse = (reason: keyof typeof VOICE_CLOSE) => {
          try {
            socket.send(JSON.stringify({ type: 'closing', reason }));
          } catch {
            /* gone */
          }
          socket.close(VOICE_CLOSE[reason], reason);
        };
        if (!deps.pool || !deps.authenticate) return refuse('UNAVAILABLE');
        if (registry.unauthenticated >= registry.maxUnauthenticated) return refuse('QUOTA');

        const session = new VoiceSession(
          {
            ai: {
              pool: deps.pool,
              ai: deps.ai,
              ...(deps.hooks ? { hooks: deps.hooks } : {}),
              log: (message, data) => request.log.warn(data, message),
              metric: (message, data) => request.log.info(data, message),
            },
            authenticate: deps.authenticate,
            tokenExpiry,
            liveFor: deps.liveFor,
            registry,
            limits,
            rateLimiter: deps.rateLimiter,
          },
          { send: (text) => socket.send(text), close: (code, reason) => socket.close(code, reason) },
        );
        socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
          const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
          if (isBinary) session.onBinary(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
          else session.onText(buffer.toString('utf8'));
        });
        socket.on('close', () => session.onSocketClosed());
        socket.on('error', () => session.onSocketClosed());
      },
    );
  }
}
