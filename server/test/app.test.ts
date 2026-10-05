import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, healthResponseSchema } from '@tinker/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/infrastructure/config/config.ts';

const DIAGRAM = '11111111-1111-4111-8111-111111111111';
const NODE_A = '22222222-2222-4222-8222-222222222222';
const KEY = '6f1d2c3a-8b7e-4f10-9a11-0123456789ab';
const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

const headers = { authorization: 'Bearer test', 'idempotency-key': KEY, 'content-type': 'application/json' };
const post = (app: FastifyInstance, payload: unknown, h: Record<string, string> = headers, id = DIAGRAM) =>
  app.inject({ method: 'POST', url: `/v1/diagrams/${id}/commands`, headers: h, payload: JSON.stringify(payload) });

function expectEnvelope(res: { statusCode: number; json: () => unknown }, status: number, code: string) {
  expect(res.statusCode).toBe(status);
  const parsed = errorEnvelopeSchema.safeParse(res.json());
  expect(parsed.success, JSON.stringify(res.json())).toBe(true);
  expect(parsed.success && parsed.data.error.code).toBe(code);
}

describe('API foundation (authenticated test app)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config, logger: false, authenticate: async () => ({ userId: 'test-user' }) });
  });
  afterAll(() => app.close());

  it('serves /health without authentication', async () => {
    const locked = await buildApp({ config, logger: false });
    const res = await locked.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.safeParse(res.json()).success).toBe(true);
    await locked.close();
  });

  it('echoes a safe request id and generates one otherwise', async () => {
    const supplied = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'req-abc-12345' } });
    expect(supplied.headers['x-request-id']).toBe('req-abc-12345');
    const unsafe = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'bad id\twith spaces' } });
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the error envelope with the request id for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope', headers: { 'x-request-id': 'req-abc-12345' } });
    expectEnvelope(res, 404, 'NOT_FOUND');
    expect(res.json().error.requestId).toBe('req-abc-12345');
  });

  it('rejects malformed JSON, wrong content type and oversized bodies consistently', async () => {
    const malformed = await app.inject({ method: 'POST', url: `/v1/diagrams/${DIAGRAM}/commands`, headers, payload: '{not json' });
    expectEnvelope(malformed, 400, 'INVALID_REQUEST');
    const wrongType = await app.inject({
      method: 'POST', url: `/v1/diagrams/${DIAGRAM}/commands`, headers: { ...headers, 'content-type': 'text/plain' }, payload: 'x',
    });
    expectEnvelope(wrongType, 400, 'INVALID_REQUEST');
    const huge = await app.inject({
      method: 'POST', url: `/v1/diagrams/${DIAGRAM}/commands`, headers, payload: JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }),
    });
    expectEnvelope(huge, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('rejects bad diagram ids and missing or invalid idempotency keys', async () => {
    expectEnvelope(await post(app, { expectedVersion: 1, command: { type: 'RESET' } }, headers, 'not-a-uuid'), 400, 'INVALID_REQUEST');
    const { 'idempotency-key': _omit, ...noKey } = headers;
    expectEnvelope(await post(app, { expectedVersion: 1, command: { type: 'RESET' } }, noKey), 400, 'INVALID_REQUEST');
    expectEnvelope(await post(app, { expectedVersion: 1, command: { type: 'RESET' } }, { ...headers, 'idempotency-key': 'short' }), 400, 'INVALID_REQUEST');
  });

  it('rejects an invalid envelope as INVALID_REQUEST and an invalid command as INVALID_COMMAND', async () => {
    expectEnvelope(await post(app, { command: { type: 'RESET' } }), 400, 'INVALID_REQUEST');
    expectEnvelope(await post(app, { expectedVersion: 0, command: { type: 'RESET' } }), 400, 'INVALID_REQUEST');
    expectEnvelope(await post(app, { expectedVersion: 1, command: { type: 'DROP_TABLE' } }), 400, 'INVALID_COMMAND');
    expectEnvelope(await post(app, { expectedVersion: 1, command: { type: 'REMOVE_NODE', nodeId: 'orders' } }), 400, 'INVALID_COMMAND');
    expectEnvelope(await post(app, { expectedVersion: 1 }), 400, 'INVALID_REQUEST');
  });

  it('does not echo submitted values in validation details', async () => {
    const res = await post(app, { expectedVersion: 1, command: { type: 'REMOVE_NODE', nodeId: 'SECRET-VALUE-123' } });
    expect(JSON.stringify(res.json())).not.toContain('SECRET-VALUE-123');
  });

  it('accepts a valid command at the contract layer, then reports not implemented', async () => {
    const res = await post(app, { expectedVersion: 14, command: { type: 'REMOVE_NODE', nodeId: NODE_A } });
    expectEnvelope(res, 501, 'NOT_IMPLEMENTED');
  });

  it('validates the presentation patch contract', async () => {
    const patch = (payload: unknown) =>
      app.inject({ method: 'PATCH', url: `/v1/diagrams/${DIAGRAM}/presentation`, headers, payload: JSON.stringify(payload) });
    expectEnvelope(await patch({ expectedVersion: 2 }), 400, 'INVALID_REQUEST');
    expectEnvelope(await patch({ expectedVersion: 2, nodePositions: { [NODE_A]: { x: 'a', y: 1 } } }), 400, 'INVALID_REQUEST');
    expectEnvelope(await patch({ expectedVersion: 2, nodePositions: { [NODE_A]: { x: 1, y: 1 } } }), 501, 'NOT_IMPLEMENTED');
  });
});

describe('authentication ordering', () => {
  it('answers 401 before validating anything when no verifier is installed (default)', async () => {
    const app = await buildApp({ config, logger: false });
    const res = await app.inject({ method: 'POST', url: `/v1/diagrams/${DIAGRAM}/commands`, headers: { 'content-type': 'application/json' }, payload: '{not json' });
    expectEnvelope(res, 401, 'UNAUTHENTICATED');
    await app.close();
  });
});

describe('CORS', () => {
  it('allows configured origins and withholds the header for others', async () => {
    const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', CORS_ORIGINS: 'https://app.example.com' }), logger: false });
    const allowed = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://app.example.com' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
    const denied = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example.com' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
