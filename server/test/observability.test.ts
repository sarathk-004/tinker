import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatSummary, percentile, summarize } from '../src/infrastructure/observability/log-report.ts';
import { call, cmd, createDiagramFor, key, startHarness, type Harness, type TestUser } from './support/harness.ts';

describe('structured request logs', () => {
  let h: Harness;
  let u: TestUser;
  const lines: string[] = [];
  beforeAll(async () => {
    h = await startHarness({ env: { LOG_LEVEL: 'info' }, logStream: { write: (line) => void lines.push(line) } });
    u = await h.newUser('observed');
  });
  afterAll(() => h.close());

  const requests = () => lines.map((l) => JSON.parse(l)).filter((e) => e.msg === 'request');

  it('logs one line per API request with the route PATTERN, status, duration and the error code; never ids, bodies or tokens', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Observed');
    const id = diagram.diagramId;
    await cmd(id, u, h, 1, { type: 'ADD_NODE', node: { name: 'SecretCustomerName', kind: 'SERVICE' } });
    await cmd(id, u, h, 1, { type: 'ADD_NODE', node: { name: 'Again', kind: 'SERVICE' } }); // stale: conflict
    await call(h, u, 'GET', `/v1/diagrams/${id}`);
    await call(h, null, 'GET', `/v1/diagrams/${id}`); // unauthenticated

    const logged = requests();
    const commands = logged.filter((e) => e.route === '/v1/diagrams/:diagramId/commands');
    expect(commands.map((e) => [e.status, e.code])).toEqual([[200, undefined], [409, 'DIAGRAM_VERSION_CONFLICT']]);
    expect(commands.every((e) => typeof e.ms === 'number' && e.ms >= 0 && e.method === 'POST')).toBe(true);
    expect(logged.some((e) => e.route === '/v1/diagrams/:diagramId' && e.status === 200)).toBe(true);
    expect(logged.some((e) => e.status === 401 && e.code === 'UNAUTHENTICATED')).toBe(true);

    const text = lines.join('\n');
    expect(text).not.toContain(id); // route patterns only, never the diagram id
    expect(text).not.toContain('SecretCustomerName');
    expect(text).not.toContain(u.token);
    expect(text).not.toContain(key().slice(0, 4) + 'zzzz'); // (no idempotency keys either: redacted by the logger config)
  });

  it('the report turns the logs into percentiles, conflicts and error codes', async () => {
    const summary = summarize(lines);
    expect(summary.requests).toBeGreaterThan(0);
    expect(summary.conflicts).toBeGreaterThanOrEqual(1);
    expect(summary.errorCodes['DIAGRAM_VERSION_CONFLICT']).toBeGreaterThanOrEqual(1);
    const commandRoute = summary.routes.find((r) => r.route === 'POST /v1/diagrams/:diagramId/commands')!;
    expect(commandRoute.count).toBe(2);
    expect(commandRoute.p95).toBeGreaterThanOrEqual(commandRoute.p50);
    expect(commandRoute.statuses).toMatchObject({ '200': 1, '409': 1 });
    expect(formatSummary(summary)).toContain('conflicts (409 version)');
  });
});

describe('log report', () => {
  it('nearest-rank percentiles', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 99)).toBe(99);
    expect(percentile([3, 1, 2], 100)).toBe(3);
  });

  it('summarizes AI attempts and failures, job leases and voice sessions, and ignores lines that are not logs', () => {
    const lines = [
      'not json at all',
      JSON.stringify({ msg: 'ai provider attempt', attempt: 0, ms: 1500, outcome: 'ok' }),
      JSON.stringify({ msg: 'ai provider attempt', attempt: 0, ms: 7500, outcome: 'timeout' }),
      JSON.stringify({ msg: 'ai provider attempt', attempt: 1, ms: 2500, outcome: 'ok' }),
      JSON.stringify({ msg: 'ai provider failure', kind: 'timeout' }),
      JSON.stringify({ msg: 'speech failure', kind: 'rate_limited' }),
      JSON.stringify({ msg: 'job claimed', type: 'PRUNE_REVISIONS', attempt: 1, tookOver: false }),
      JSON.stringify({ msg: 'job claimed', type: 'PRUNE_REVISIONS', attempt: 2, tookOver: true }),
      JSON.stringify({ msg: 'job completed', type: 'PRUNE_REVISIONS', attempt: 2, ms: 40 }),
      JSON.stringify({ msg: 'job fenced', type: 'PURGE_DELETED_DIAGRAMS', attempt: 1, ms: 900 }),
      JSON.stringify({ msg: 'job will retry', type: 'PURGE_DELETED_DIAGRAMS', attempt: 1, ms: 10, kind: 'INTERNAL' }),
      JSON.stringify({ msg: 'job dead-lettered', type: 'PURGE_DELETED_DIAGRAMS', attempt: 3, ms: 10, kind: 'EXTERNAL' }),
      JSON.stringify({ msg: 'voice session ended', reason: 'IDLE' }),
    ];
    const s = summarize(lines);
    expect(s.lines).toBe(12);
    expect(s.ai.attempts).toEqual({ ok: 2, timeout: 1 });
    expect(s.ai.latencyOkMs).toEqual({ count: 2, p50: 1500, p95: 2500, max: 2500 });
    expect(s.ai.failures).toEqual({ 'ai provider failure: timeout': 1, 'speech failure: rate_limited': 1 });
    expect(s.jobs).toMatchObject({ claimed: 2, takeovers: 1, completed: 1, retried: 1, deadLettered: 1, fenced: 1 });
    expect(s.voice).toEqual({ sessions: 1, reasons: { IDLE: 1 } });
  });
});
