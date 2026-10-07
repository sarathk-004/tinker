import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { VOICE_PATH, errorEnvelopeSchema, meResponseSchema } from '@tinker/shared';
import { createFakeProvider } from '../../src/modules/ai/providers/fake.ts';
import { createFakeLive } from '../../src/modules/voice/fake-live.ts';
import { createFakeSpeech } from '../../src/modules/voice/speech-provider.ts';
import { createPool } from '../../src/infrastructure/database/pool.ts';
import { createDailyUsage, nextResetUtc } from '../../src/modules/usage/daily-usage.ts';
import { aiCmd, call, createDiagramFor, startHarness, type Harness, type TestUser } from '../support/harness.ts';
import { inject } from 'vitest';

const FREE_FORM = 'sprinkle some caching between the orders component and the postgresql database';
const modelPlan = { outcome: 'COMMANDS', commands: [{ type: 'ADD_NODE', name: 'Redis', kind: 'CACHE' }] };

describe('daily AI allowance: the spend cap (security review H1)', () => {
  let h: Harness;
  let a: TestUser;
  let b: TestUser;
  beforeAll(async () => {
    h = await startHarness({
      aiProvider: createFakeProvider(Array.from({ length: 20 }, () => ({ output: modelPlan, delayMs: 0 })) as never),
      env: { AI_DAILY_LIMIT: '3', VOICE_DAILY_LIMIT: '2', AI_GLOBAL_DAILY_LIMIT: '100000000', AI_RATE_LIMIT_PER_MINUTE: '1000', AI_MAX_CONCURRENT: '10' },
    });
    a = await h.newUser('capped-a');
    b = await h.newUser('capped-b');
  });
  afterAll(() => h.close());

  it('model requests are refused after the daily limit, with a clear message, and the diagram is untouched', async () => {
    const { diagram } = await createDiagramFor(h, a);
    let version = diagram.version as number;
    for (let i = 0; i < 3; i++) {
      const r = await aiCmd(h, a, diagram.diagramId, version, `${FREE_FORM} ${i}`);
      expect(r.status).toBe(200);
      version = r.body.diagram.version;
    }
    const fourth = await aiCmd(h, a, diagram.diagramId, version, `${FREE_FORM} 4`);
    expect(fourth.status).toBe(429);
    expect(errorEnvelopeSchema.parse(fourth.body).error.code).toBe('DAILY_LIMIT_REACHED');
    expect(fourth.body.error.details).toMatchObject({ scope: 'USER', kind: 'AI', limit: 3 });
    expect(fourth.body.error.message).toMatch(/3 AI requests/);
    const after = await call(h, a, 'GET', `/v1/diagrams/${diagram.diagramId}`);
    expect(after.body.version).toBe(version);
  });

  it('plain commands the parser understands are never counted, even after the limit', async () => {
    const { diagram } = await createDiagramFor(h, a, 'plain');
    const r = await aiCmd(h, a, diagram.diagramId, diagram.version, 'add Orders');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('PARSER');
  });

  it('one person reaching the limit does not affect another person', async () => {
    const { diagram } = await createDiagramFor(h, b);
    const r = await aiCmd(h, b, diagram.diagramId, diagram.version, FREE_FORM);
    expect(r.status).toBe(200);
  });

  it('a question still gets an answer after the limit (the computed analysis, not the model)', async () => {
    const { diagram } = await createDiagramFor(h, a, 'asking');
    const r = await call(h, a, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/ask`, { question: 'What happens if Orders goes down?' });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('ANALYZER');
  });

  it('/v1/me shows the allowance and when it resets', async () => {
    const me = await call(h, a, 'GET', '/v1/me');
    const parsed = meResponseSchema.parse(me.body);
    expect(parsed.quota.ai).toEqual({ used: 3, limit: 3 });
    expect(parsed.quota.voice).toEqual({ used: 0, limit: 2 });
    expect(new Date(parsed.quota.resetsAt).getTime()).toBeGreaterThan(Date.now());
    const mine = await call(h, b, 'GET', '/v1/me');
    expect(mine.body.quota.ai.used).toBe(1);
  });

  it('API answers are not cacheable and not sniffable', async () => {
    const me = await call(h, a, 'GET', '/v1/me');
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('daily AI allowance: the counters themselves', () => {
  const pool = createPool(inject('dbUrl'));
  afterAll(() => pool.end());
  const limits = { ai: 3, voice: 2, globalAi: 1000, globalVoice: 1000 };
  const user = () => crypto.randomUUID();

  it('simultaneous requests can never take more than the limit', async () => {
    const usage = createDailyUsage(pool, limits);
    const id = user();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => usage.consume(id, 'AI')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected' && (r.reason as { code: string }).code === 'DAILY_LIMIT_REACHED')).toHaveLength(9);
    expect((await usage.snapshot(id)).ai.used).toBe(3);
  });

  it('the service-wide ceiling pauses everyone, and a refusal does not charge the person', async () => {
    const scope = `breaker-${crypto.randomUUID().slice(0, 8)}`;
    // A global ceiling of 2 on a kind shared with other tests would be flaky, so use the VOICE kind on a fresh database day row.
    await pool.query(`DELETE FROM usage_daily WHERE scope = 'GLOBAL' AND day = (now() AT TIME ZONE 'UTC')::date AND kind = 'VOICE'`);
    const usage = createDailyUsage(pool, { ...limits, globalVoice: 2 });
    const [p, q, r] = [user(), user(), user()];
    await usage.consume(p, 'VOICE');
    await usage.consume(q, 'VOICE');
    const refused = await usage.consume(r, 'VOICE').catch((e) => e);
    expect(refused.code).toBe('DAILY_LIMIT_REACHED');
    expect(refused.details.scope).toBe('SERVICE');
    expect((await usage.snapshot(r)).voice.used).toBe(0);
    await pool.query(`DELETE FROM usage_daily WHERE scope = 'GLOBAL' AND kind = 'VOICE'`);
    expect(scope).toBeTruthy();
  });

  it('resets at the next UTC midnight', () => {
    expect(nextResetUtc(new Date('2026-10-07T23:59:59Z')).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(nextResetUtc(new Date('2026-12-31T12:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('daily allowance: voice sessions and spoken replies', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness({
      liveGateway: createFakeLive(),
      speechProvider: createFakeSpeech(),
      aiProvider: createFakeProvider([]),
      env: { AI_DAILY_LIMIT: '1', VOICE_DAILY_LIMIT: '1', AI_GLOBAL_DAILY_LIMIT: '100000000', VOICE_GLOBAL_DAILY_LIMIT: '100000000' },
    });
    u = await h.newUser('voice-capped');
  });
  afterAll(() => h.close());

  async function session(diagramId: string, version: number): Promise<{ messages: Array<Record<string, any>>; ws: WebSocket }> {
    const ws = (await h.app.injectWS(VOICE_PATH, { headers: { origin: 'http://localhost:5173' } })) as unknown as WebSocket;
    const messages: Array<Record<string, any>> = [];
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) messages.push(JSON.parse(data.toString('utf8')));
    });
    ws.send(JSON.stringify({ type: 'hello', token: u.token, diagramId, version }));
    const deadline = Date.now() + 3000;
    while (!messages.some((m) => m.type === 'ready') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    ws.send(JSON.stringify({ type: 'start' }));
    while (!messages.some((m) => m.type === 'listening' || m.type === 'error') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    return { messages, ws };
  }

  it('the first voice session opens; the next one is refused with a clear, non-fatal message', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const first = await session(diagram.diagramId, diagram.version);
    expect(first.messages.some((m) => m.type === 'listening')).toBe(true);
    first.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const second = await session(diagram.diagramId, diagram.version);
    const error = second.messages.find((m) => m.type === 'error');
    expect(error).toMatchObject({ code: 'DAILY_LIMIT_REACHED', fatal: false });
    expect(error!.message).toMatch(/voice sessions/);
    second.ws.close();
  });
});

describe('process safety (security review H2)', () => {
  it('a dropped idle database connection is logged, not fatal', () => {
    const pool = createPool(inject('dbUrl'));
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: string) => void lines.push(line);
    try {
      expect(() => pool.emit('error', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }))).not.toThrow();
    } finally {
      console.error = original;
      void pool.end();
    }
    expect(lines.join('')).toContain('idle database connection failed');
    expect(lines.join('')).not.toContain('administrator command'); // the message could carry connection details: name and code only
  });
});
