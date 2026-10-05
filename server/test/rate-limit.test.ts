import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/infrastructure/http/rate-limiter.ts';
import { call, startHarness, type Harness, type TestUser } from './support/harness.ts';

describe('rate limiter (D10: single instance, in memory)', () => {
  it('allows up to the limit per user per window, then refuses with a retry hint', () => {
    let t = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    for (let i = 0; i < 3; i++) limiter.check('a');
    expect(() => limiter.check('a')).toThrow(expect.objectContaining({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 60 } }));
    limiter.check('b'); // other users are independent
    t += 30_000;
    expect(() => limiter.check('a')).toThrow(expect.objectContaining({ details: { retryAfterSeconds: 30 } }));
    t += 30_000; // new window
    limiter.check('a');
  });
});

describe('rate limiting over HTTP', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness({ rateLimiter: createRateLimiter({ limit: 3 }) });
    u = await h.newUser('limited');
  });
  afterAll(() => h.close());

  it('returns 429 RATE_LIMITED with Retry-After once the allowance is spent, per user', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call(h, u, 'GET', '/v1/me')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const limited = await call(h, u, 'GET', '/v1/me');
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const other = await h.newUser('unaffected');
    expect((await call(h, other, 'GET', '/v1/me')).status).toBe(200);
  });

  it('does not rate limit health checks', async () => {
    for (let i = 0; i < 10; i++) expect((await call(h, null, 'GET', '/health')).status).toBe(200);
  });
});
