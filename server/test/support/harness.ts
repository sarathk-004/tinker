import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLocalSigner, type LocalSigner } from '../../src/infrastructure/auth/verifier.ts';
import { loadConfig } from '../../src/infrastructure/config/config.ts';
import { createPool, type Pool } from '../../src/infrastructure/database/pool.ts';
import type { TestHooks } from '../../src/infrastructure/idempotency/mutation-requests.ts';
import type { RateLimiter } from '../../src/infrastructure/http/rate-limiter.ts';
import type { InterpretationProvider } from '../../src/modules/ai/providers/types.ts';
import type { LiveGateway } from '../../src/modules/voice/live-gateway.ts';
import type { VoiceSessionLimits } from '../../src/modules/voice/voice-session.ts';

export interface Harness {
  app: FastifyInstance;
  pool: Pool;
  signer: LocalSigner;
  /** A fresh, isolated user (unique subject) with a bearer token. */
  newUser(label?: string): Promise<TestUser>;
  close(): Promise<void>;
}

export interface TestUser {
  subject: string;
  token: string;
  headers: (extra?: Record<string, string>) => Record<string, string>;
}

export interface HarnessOptions {
  hooks?: TestHooks;
  rateLimiter?: RateLimiter;
  aiProvider?: InterpretationProvider;
  aiRateLimiter?: RateLimiter;
  liveGateway?: LiveGateway;
  voiceLimits?: Partial<VoiceSessionLimits>;
  env?: Record<string, string>;
  /** Share an existing pool/signer (simulates an API restart against the same database). */
  pool?: Pool;
  signer?: LocalSigner;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const pool = options.pool ?? createPool(inject('dbUrl'));
  const signer = options.signer ?? (await createLocalSigner());
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...options.env });
  const app = await buildApp({
    config,
    pool,
    verifier: signer.verify,
    logger: false,
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.rateLimiter ? { rateLimiter: options.rateLimiter } : {}),
    ...(options.aiProvider ? { aiProvider: options.aiProvider } : {}),
    ...(options.aiRateLimiter ? { aiRateLimiter: options.aiRateLimiter } : {}),
    ...(options.liveGateway ? { liveGateway: options.liveGateway } : {}),
    ...(options.voiceLimits ? { voiceLimits: options.voiceLimits } : {}),
  });
  return {
    app,
    pool,
    signer,
    async newUser(label = 'user') {
      const subject = `test:${label}:${randomUUID()}`;
      const token = await signer.sign({ subject, email: `${subject}@example.test` });
      return { subject, token, headers: (extra = {}) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }) };
    },
    async close() {
      await app.close();
      if (!options.pool) await pool.end();
    },
  };
}

export const key = () => randomUUID();

/** Typed helper around app.inject for JSON APIs. */
export async function call<T = any>(
  h: Harness,
  user: TestUser | null,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T; headers: Record<string, unknown> }> {
  const res = await h.app.inject({
    method,
    url,
    headers: user ? user.headers(headers) : { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, body: res.body ? (res.json() as T) : (undefined as T), headers: res.headers };
}

/** The user's personal workspace id. */
export async function personalWorkspace(h: Harness, user: TestUser): Promise<string> {
  const me = await call(h, user, 'GET', '/v1/me');
  return me.body.workspaces.find((w: { personal: boolean }) => w.personal).id as string;
}

/** Create a diagram in the user's personal workspace. */
export async function createDiagramFor(h: Harness, user: TestUser, name = 'Test diagram') {
  const workspaceId = await personalWorkspace(h, user);
  const res = await call(h, user, 'POST', `/v1/workspaces/${workspaceId}/diagrams`, { name }, { 'idempotency-key': key() });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { workspaceId, diagram: res.body };
}

export const cmd = (diagramId: string, user: TestUser, h: Harness, expectedVersion: number, command: unknown, idemKey = key()) =>
  call(h, user, 'POST', `/v1/diagrams/${diagramId}/commands`, { expectedVersion, command }, { 'idempotency-key': idemKey });

/** POST /v1/diagrams/{id}/ai/command */
export const aiCmd = (
  h: Harness,
  user: TestUser,
  diagramId: string,
  expectedVersion: number,
  text: string,
  opts: { key?: string; conversationId?: string } = {},
) =>
  call(
    h,
    user,
    'POST',
    `/v1/diagrams/${diagramId}/ai/command`,
    { expectedVersion, ...(opts.conversationId ? { conversationId: opts.conversationId } : {}), input: { type: 'TEXT', text } },
    { 'idempotency-key': opts.key ?? key() },
  );
