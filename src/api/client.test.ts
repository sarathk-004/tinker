import { describe, expect, it, vi } from 'vitest';
import { createApiClient, ApiError, type AuthSource } from './client';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc = (version = 2) => ({
  diagramId: U(1),
  version,
  appliedCommand: { type: 'ADD_NODE' as const },
  graph: { schemaVersion: 1 as const, nodes: [], edges: [] },
  presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
});
const envelope = (code: string, extra: Record<string, unknown> = {}) => ({ error: { code, message: `${code} happened`, requestId: 'req-1', ...extra } });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function setup(responses: Array<Response | Error | (() => Response | Error)>, authOver: Partial<AuthSource> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra request');
    const value = typeof next === 'function' ? next() : next;
    if (value instanceof Error) throw value;
    return value;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const auth: AuthSource = {
    getAccessToken: async () => 'token-1',
    refresh: async () => null,
    onUnauthorized: vi.fn(),
    ...authOver,
  };
  const client = createApiClient({ baseUrl: 'http://api.test', auth, fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
  return { client, calls, sleeps, auth, fetchImpl };
}

const spec = { method: 'POST' as const, path: `/v1/diagrams/${U(1)}/commands`, body: { expectedVersion: 1, command: { type: 'RESET' } }, idempotencyKey: 'key-0123456789' };

describe('api client', () => {
  it('sends the bearer token, idempotency key and JSON body, and validates the response', async () => {
    const { client, calls } = setup([json(200, doc())]);
    const res = await client.mutate.command(spec);
    expect(res.data.version).toBe(2);
    expect(res.replayed).toBe(false);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h).toMatchObject({ authorization: 'Bearer token-1', 'idempotency-key': 'key-0123456789', 'content-type': 'application/json' });
    expect(calls[0]!.url).toBe(`http://api.test/v1/diagrams/${U(1)}/commands`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(spec.body);
  });

  it('reports a stored replay from the header or the body marker', async () => {
    const a = await setup([json(200, doc(), { 'idempotent-replayed': 'true' })]).client.mutate.command(spec);
    const b = await setup([json(200, { ...doc(), replayed: true })]).client.mutate.command(spec);
    expect([a.replayed, b.replayed]).toEqual([true, true]);
  });

  it('retries a lost response (network error) with the SAME key and byte-identical body', async () => {
    const { client, calls, sleeps } = setup([new TypeError('fetch failed'), new TypeError('fetch failed'), json(200, doc())]);
    await client.mutate.command(spec);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key']))).toEqual(new Set(['key-0123456789']));
    expect(new Set(calls.map((c) => c.init.body)).size).toBe(1);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]! - 200); // backoff grows (modulo jitter)
  });

  it('retries transient server answers per the contract retry policy and honours Retry-After', async () => {
    const { client, calls, sleeps } = setup([
      json(503, envelope('SERVICE_UNAVAILABLE')),
      json(409, envelope('REQUEST_ALREADY_PROCESSING')),
      json(429, envelope('RATE_LIMITED'), { 'retry-after': '2' }),
      json(200, doc()),
    ]);
    await client.mutate.command(spec);
    expect(calls).toHaveLength(4);
    expect(sleeps[2]).toBe(2000);
  });

  it('does NOT retry answers that cannot succeed by retrying (conflict, refusal, validation, permission)', async () => {
    for (const [status, code] of [[409, 'DIAGRAM_VERSION_CONFLICT'], [422, 'DOMAIN_VALIDATION_FAILED'], [400, 'INVALID_COMMAND'], [403, 'FORBIDDEN'], [404, 'DIAGRAM_NOT_FOUND'], [409, 'IDEMPOTENCY_KEY_REUSED']] as const) {
      const { client, calls } = setup([json(status, envelope(code, { details: { expectedVersion: 1, currentVersion: 2 } }))]);
      const error = await client.mutate.command(spec).catch((e) => e as ApiError);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(code);
      expect((error as ApiError).retryable).toBe(false);
      expect(calls, code).toHaveLength(1);
    }
  });

  it('exposes error details (e.g. versions) and the request id for support', async () => {
    const { client } = setup([json(409, envelope('DIAGRAM_VERSION_CONFLICT', { details: { expectedVersion: 1, currentVersion: 5 } }))]);
    const error = (await client.mutate.command(spec).catch((e) => e)) as ApiError;
    expect(error.details).toEqual({ expectedVersion: 1, currentVersion: 5 });
    expect(error.requestId).toBe('req-1');
    expect(error.status).toBe(409);
  });

  it('gives up after the attempt budget with a retryable error (the caller may resume later with the same key)', async () => {
    const { client, calls } = setup(Array.from({ length: 5 }, () => new TypeError('offline')));
    const error = (await client.mutate.command(spec).catch((e) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.retryable).toBe(true);
    expect(calls).toHaveLength(5);
  });

  it('maps a timeout to TIMEOUT (retryable)', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { client } = setup(Array.from({ length: 5 }, () => timeout));
    const error = (await client.mutate.command(spec).catch((e) => e)) as ApiError;
    expect(error.code).toBe('TIMEOUT');
    expect(error.retryable).toBe(true);
  });

  it('treats a non-API error page (proxy 502) as transient, but a malformed 200 as a bad response (not retried)', async () => {
    const proxy = setup([new Response('<html>Bad gateway</html>', { status: 502 }), json(200, doc())]);
    await proxy.client.mutate.command(spec);
    expect(proxy.calls).toHaveLength(2);

    const bad = setup([json(200, { version: 'two' })]);
    const error = (await bad.client.mutate.command(spec).catch((e) => e)) as ApiError;
    expect(error.code).toBe('BAD_RESPONSE');
    expect(bad.calls).toHaveLength(1);
  });

  it('401: refreshes credentials once and retries; without a new token it signs out', async () => {
    let token = 'old';
    const refreshed = setup(
      [json(401, envelope('UNAUTHENTICATED')), json(200, doc())],
      { getAccessToken: async () => token, refresh: async () => (token = 'new') },
    );
    await refreshed.client.mutate.command(spec);
    expect((refreshed.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer old');
    expect((refreshed.calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer new');

    const dead = setup([json(401, envelope('UNAUTHENTICATED'))]);
    const error = (await dead.client.mutate.command(spec).catch((e) => e)) as ApiError;
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(dead.auth.onUnauthorized).toHaveBeenCalledTimes(1);

    const stillBad = setup(
      [json(401, envelope('UNAUTHENTICATED')), json(401, envelope('UNAUTHENTICATED'))],
      { refresh: async () => 'fresh-but-rejected' },
    );
    await stillBad.client.mutate.command(spec).catch(() => undefined);
    expect(stillBad.calls).toHaveLength(2); // exactly one refresh attempt, no loop
    expect(stillBad.auth.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reads send no idempotency key or body', async () => {
    const { client, calls } = setup([json(200, { diagrams: [] })]);
    await client.listDiagrams(U(7));
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['idempotency-key']).toBeUndefined();
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.init.method).toBe('GET');
  });
});

describe('api client: typed commands', () => {
  const aiSpec = { method: 'POST' as const, path: `/v1/diagrams/${U(1)}/ai/command`, body: { expectedVersion: 1, input: { type: 'TEXT', text: 'add Redis' } }, idempotencyKey: 'key-ai-0123456' };
  const applied = {
    status: 'APPLIED',
    source: 'PARSER',
    interpretation: { commands: [{ type: 'ADD_NODE', summary: 'Added Redis' }] },
    conversationId: U(5),
    messages: [],
    diagram: { id: U(1), version: 2, graph: { schemaVersion: 1, nodes: [], edges: [] }, presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } } },
  };

  it('validates and returns the answer', async () => {
    const { client } = setup([json(200, applied)]);
    const res = await client.mutate.ai(aiSpec);
    expect(res.data.status).toBe('APPLIED');
  });

  it('does not automatically retry provider failures or rate limits: they reach the user at once', async () => {
    for (const [status, code] of [[504, 'AI_TIMEOUT'], [502, 'AI_PROVIDER_ERROR'], [503, 'AI_UNAVAILABLE'], [429, 'RATE_LIMITED']] as const) {
      const { client, calls } = setup([json(status, envelope(code))]);
      const error = (await client.mutate.ai(aiSpec).catch((e) => e)) as ApiError;
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(false);
      expect(calls, code).toHaveLength(1);
    }
  });

  it('still retries a lost response with the same key (replay-safe)', async () => {
    const { client, calls } = setup([new TypeError('offline'), json(200, applied)]);
    await client.mutate.ai(aiSpec);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key']))).toEqual(new Set(['key-ai-0123456']));
  });

  it('manual commands keep their automatic retry of the same codes', async () => {
    const { client, calls } = setup([json(503, envelope('AI_UNAVAILABLE')), json(200, doc())]);
    await client.mutate.command(spec);
    expect(calls).toHaveLength(2);
  });

  it('loads the saved conversation', async () => {
    const { client } = setup([json(200, { conversationId: null, messages: [] })]);
    expect(await client.conversation(U(1))).toEqual({ conversationId: null, messages: [] });
  });
});
