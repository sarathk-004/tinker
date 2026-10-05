import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { LIMITS, type HealthResponse } from '@tinker/shared';
import type { Config } from './infrastructure/config/config.ts';
import { rejectAllAuthenticator, type Authenticator } from './infrastructure/auth/authenticator.ts';
import { AppError, toErrorResponse } from './infrastructure/http/errors.ts';
import { registerDiagramRoutes } from './modules/diagrams/http/routes.ts';

export interface BuildAppOptions {
  config: Config;
  /** Defaults to rejecting every request until real token verification exists (I3). */
  authenticate?: Authenticator;
  /** Tests disable logging. */
  logger?: boolean;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({
    bodyLimit: LIMITS.maxRequestBodyBytes,
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
          },
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorResponse(error, request.id);
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

  await registerDiagramRoutes(app, options.authenticate ?? rejectAllAuthenticator);

  return app;
}
