import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, healthResponseSchema } from '@tinker/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/infrastructure/config/config.ts';
import { call, createDiagramFor, key, startHarness, type Harness, type TestUser } from './support/harness.ts';

const DIAGRAM = '11111111-1111-4111-8111-111111111111';
const NODE_A = '22222222-2222-4222-8222-222222222222';

function expectEnvelope(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = errorEnvelopeSchema.safeParse(res.body);
  expect(parsed.success, JSON.stringify(res.body)).toBe(true);
  expect(parsed.success && parsed.data.error.code).toBe(code);
}

describe('API foundation (real auth, real database)', () => {
  let h: Harness;
  let user: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    user = await h.newUser();
  });
  afterAll(() => h.close());

  it('serves liveness without authentication and readiness when the database is reachable', async () => {
    const live = await call(h, null, 'GET', '/health');
    expect(live.status).toBe(200);
    expect(healthResponseSchema.safeParse(live.body).success).toBe(true);
    expect((await call(h, null, 'GET', '/health/ready')).status).toBe(200);
  });

  it('echoes a safe request id and regenerates unsafe ones', async () => {
    const supplied = await call(h, null, 'GET', '/health', undefined, { 'x-request-id': 'req-abc-12345' });
    expect(supplied.headers['x-request-id']).toBe('req-abc-12345');
    const unsafe = await call(h, null, 'GET', '/health', undefined, { 'x-request-id': 'bad id\twith spaces' });
    expect(String(unsafe.headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers unknown routes with the error envelope', async () => {
    const res = await call(h, null, 'GET', '/nope', undefined, { 'x-request-id': 'req-abc-12345' });
    expectEnvelope(res, 404, 'NOT_FOUND');
    expect((res.body as { error: { requestId: string } }).error.requestId).toBe('req-abc-12345');
  });

  it('answers 401 before parsing or validating anything when credentials are missing or bad', async () => {
    const noToken = await h.app.inject({ method: 'POST', url: `/v1/diagrams/${DIAGRAM}/commands`, headers: { 'content-type': 'application/json' }, payload: '{not json' });
    expectEnvelope({ status: noToken.statusCode, body: noToken.json() }, 401, 'UNAUTHENTICATED');
    const garbage = await call(h, null, 'GET', '/v1/me', undefined, { authorization: 'Bearer not.a.jwt' });
    expectEnvelope(garbage, 401, 'UNAUTHENTICATED');
    const wrongScheme = await call(h, null, 'GET', '/v1/me', undefined, { authorization: 'Basic abc' });
    expectEnvelope(wrongScheme, 401, 'UNAUTHENTICATED');
  });

  it('rejects malformed JSON, wrong content type and oversized bodies consistently', async () => {
    const url = `/v1/diagrams/${DIAGRAM}/commands`;
    const base = user.headers({ 'idempotency-key': key() });
    const malformed = await h.app.inject({ method: 'POST', url, headers: base, payload: '{not json' });
    expectEnvelope({ status: malformed.statusCode, body: malformed.json() }, 400, 'INVALID_REQUEST');
    const wrongType = await h.app.inject({ method: 'POST', url, headers: { ...base, 'content-type': 'text/plain' }, payload: 'x' });
    expectEnvelope({ status: wrongType.statusCode, body: wrongType.json() }, 400, 'INVALID_REQUEST');
    const huge = await h.app.inject({ method: 'POST', url, headers: base, payload: JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }) });
    expectEnvelope({ status: huge.statusCode, body: huge.json() }, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('rejects bad ids, missing or invalid idempotency keys, and malformed bodies (400) without touching data', async () => {
    const reset = { expectedVersion: 1, command: { type: 'RESET' } };
    expectEnvelope(await call(h, user, 'POST', '/v1/diagrams/not-a-uuid/commands', reset, { 'idempotency-key': key() }), 400, 'INVALID_REQUEST');
    expectEnvelope(await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, reset), 400, 'INVALID_REQUEST');
    expectEnvelope(await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, reset, { 'idempotency-key': 'short' }), 400, 'INVALID_REQUEST');
    const k = { 'idempotency-key': key() };
    expectEnvelope(await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, { command: { type: 'RESET' } }, k), 400, 'INVALID_REQUEST');
    expectEnvelope(await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, { expectedVersion: 0, command: { type: 'RESET' } }, k), 400, 'INVALID_REQUEST');
    expectEnvelope(await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, { expectedVersion: 1, command: { type: 'DROP_TABLE' } }, k), 400, 'INVALID_COMMAND');
    expectEnvelope(await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, { expectedVersion: 1, command: { type: 'REMOVE_NODE', nodeId: 'orders' } }, k), 400, 'INVALID_COMMAND');
    expectEnvelope(await call(h, user, 'PATCH', `/v1/diagrams/${DIAGRAM}/presentation`, { expectedVersion: 2 }, k), 400, 'INVALID_REQUEST');
    expectEnvelope(await call(h, user, 'DELETE', `/v1/diagrams/${DIAGRAM}`, undefined, k), 400, 'INVALID_REQUEST');
  });

  it('does not echo submitted values in validation details', async () => {
    const res = await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, { expectedVersion: 1, command: { type: 'REMOVE_NODE', nodeId: 'SECRET-VALUE-123' } }, { 'idempotency-key': key() });
    expect(JSON.stringify(res.body)).not.toContain('SECRET-VALUE-123');
  });

  it('an unknown diagram is a uniform 404 and valid commands run for real', async () => {
    expectEnvelope(await call(h, user, 'POST', `/v1/diagrams/${DIAGRAM}/commands`, { expectedVersion: 1, command: { type: 'REMOVE_NODE', nodeId: NODE_A } }, { 'idempotency-key': key() }), 404, 'DIAGRAM_NOT_FOUND');
    const { diagram } = await createDiagramFor(h, user);
    expect(diagram.version).toBe(1);
  });
});

describe('without a database or verifier', () => {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

  it('answers 401 for every protected route (default authenticator)', async () => {
    const app = await buildApp({ config, logger: false });
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
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
    // Browsers can only read these response headers cross-origin if they are exposed (the I4 client depends on them).
    expect(String(allowed.headers['access-control-expose-headers'])).toEqual(expect.stringContaining('idempotent-replayed'));
    expect(String(allowed.headers['access-control-expose-headers'])).toEqual(expect.stringContaining('retry-after'));
    expect(String(allowed.headers['access-control-expose-headers'])).toEqual(expect.stringContaining('x-request-id'));
    await app.close();
  });
});
