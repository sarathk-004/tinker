import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS, meResponseSchema, workspaceSummarySchema } from '@tinker/shared';
import { call, createDiagramFor, key, startHarness, type Harness, type TestUser } from '../support/harness.ts';

describe('POST /v1/workspaces', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('team-owner');
  });
  afterAll(() => h.close());

  const create = (user: TestUser | null, name: unknown, idem: string | null = key()) =>
    call(h, user, 'POST', '/v1/workspaces', { name }, idem ? { 'idempotency-key': idem } : {});

  it('creates a team workspace the caller owns, and it shows up in /v1/me next to the personal one', async () => {
    const r = await create(u, '  Acme engineering ');
    expect(r.status).toBe(201);
    expect(workspaceSummarySchema.parse(r.body)).toMatchObject({ name: 'Acme engineering', role: 'OWNER', personal: false });
    const me = meResponseSchema.parse((await call(h, u, 'GET', '/v1/me')).body);
    expect(me.workspaces.map((w) => `${w.name}:${w.personal}`).sort()).toEqual(['Acme engineering:false', 'Personal:true']);
  });

  it('a diagram can be created in it, and another person cannot see or use it', async () => {
    const w = (await create(u, 'Private team')).body;
    const made = await call(h, u, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'Team diagram' }, { 'idempotency-key': key() });
    expect(made.status).toBe(201);
    const other = await h.newUser('outsider');
    expect((await call(h, other, 'GET', `/v1/workspaces/${w.id}/diagrams`)).status).toBe(404);
    expect((await call(h, other, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'x' }, { 'idempotency-key': key() })).status).toBe(404);
    expect((await call(h, other, 'GET', `/v1/diagrams/${made.body.diagramId}`)).status).toBe(404);
  });

  it('the same Idempotency-Key creates one workspace; a different body with that key is refused', async () => {
    const user = await h.newUser('idem');
    const idem = key();
    const first = await create(user, 'Once', idem);
    const again = await create(user, 'Once', idem);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((await create(user, 'Twice', idem)).status).toBe(409);
    const names = (await call(h, user, 'GET', '/v1/workspaces')).body.workspaces.map((w: { name: string }) => w.name);
    expect(names.filter((n: string) => n === 'Once')).toHaveLength(1);
  });

  it('refuses bad names and a missing key or token', async () => {
    expect((await create(u, '')).status).toBe(400);
    expect((await create(u, '   ')).status).toBe(400);
    expect((await create(u, 'x'.repeat(LIMITS.maxWorkspaceNameLength + 1))).status).toBe(400);
    expect((await create(u, 42)).status).toBe(400);
    expect((await create(u, 'No key', null)).status).toBe(400);
    expect((await create(null, 'No token')).status).toBe(401);
  });

  it(`stops at ${LIMITS.maxOwnedWorkspaces} team workspaces, even when many are requested at the same moment`, async () => {
    const user = await h.newUser('greedy');
    const results = await Promise.all(Array.from({ length: LIMITS.maxOwnedWorkspaces + 4 }, (_, i) => create(user, `Team ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(LIMITS.maxOwnedWorkspaces);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused.every((r) => r.status === 422 && r.body.error.details.reason === 'LIMIT_EXCEEDED')).toBe(true);
    const owned = (await call(h, user, 'GET', '/v1/workspaces')).body.workspaces.filter((w: { personal: boolean }) => !w.personal);
    expect(owned).toHaveLength(LIMITS.maxOwnedWorkspaces);
  });

  it('creating a diagram still works in the personal workspace (nothing about the old path changed)', async () => {
    const user = await h.newUser('personal');
    const { diagram } = await createDiagramFor(h, user);
    expect(diagram.version).toBe(1);
  });
});
