import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meResponseSchema, workspaceDetailSchema } from '@tinker/shared';
import { call, createDiagramFor, key, startHarness, type Harness, type TestUser } from '../support/harness.ts';

const emailOf = (u: TestUser) => `${u.subject}@example.test`;

describe('workspace settings, sharing and delete', () => {
  let h: Harness;
  let owner: TestUser;
  beforeAll(async () => {
    h = await startHarness();
  });
  // A fresh owner per test: a person may own only a few team workspaces.
  beforeEach(async () => {
    owner = await h.newUser('ws-owner');
  });
  afterAll(() => h.close());

  const makeWorkspace = async (name = 'Team') => (await call(h, owner, 'POST', '/v1/workspaces', { name }, { 'idempotency-key': key() })).body as { id: string };
  const visit = async (u: TestUser) => void (await call(h, u, 'GET', '/v1/me')); // first sight creates the account
  const add = (wid: string, user: TestUser | null, email: string, role = 'EDITOR') => call(h, user, 'POST', `/v1/workspaces/${wid}/members`, { email, role });

  it('/v1/me lists each workspace with what a dashboard needs', async () => {
    const w = await makeWorkspace('Dash');
    await call(h, owner, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'One' }, { 'idempotency-key': key() });
    const me = meResponseSchema.parse((await call(h, owner, 'GET', '/v1/me')).body);
    const mine = me.workspaces.find((x) => x.id === w.id)!;
    expect(mine).toMatchObject({ name: 'Dash', visibility: 'PRIVATE', diagramCount: 1, memberCount: 1, description: null });
  });

  it('only an owner changes name, description and visibility; the detail lists the members', async () => {
    const w = await makeWorkspace('Settings');
    const editor = await h.newUser('ws-editor');
    await visit(editor);
    expect((await add(w.id, owner, emailOf(editor), 'EDITOR')).body).toEqual({ status: 'ADDED' });
    const changed = await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}`, { name: 'Renamed', description: 'Platform team', visibility: 'PUBLIC' });
    expect(changed.status).toBe(200);
    const detail = workspaceDetailSchema.parse(changed.body);
    expect(detail).toMatchObject({ name: 'Renamed', description: 'Platform team', visibility: 'PUBLIC', member: true, memberCount: 2 });
    expect(detail.members.map((m) => m.role)).toEqual(['OWNER', 'EDITOR']);
    expect((await call(h, editor, 'PATCH', `/v1/workspaces/${w.id}`, { name: 'Hijack' })).status).toBe(403);
    expect((await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}`, {})).status).toBe(400);
    expect((await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}`, { description: null })).body.description).toBeNull();
  });

  it('private stays invisible to outsiders; public is read-only for any signed-in person with the link', async () => {
    const w = await makeWorkspace('Visibility');
    const made = await call(h, owner, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'Design' }, { 'idempotency-key': key() });
    const id = made.body.diagramId as string;
    const stranger = await h.newUser('ws-stranger');
    expect((await call(h, stranger, 'GET', `/v1/workspaces/${w.id}`)).status).toBe(404);
    expect((await call(h, stranger, 'GET', `/v1/diagrams/${id}`)).status).toBe(404);

    await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}`, { visibility: 'PUBLIC' });
    const seen = workspaceDetailSchema.parse((await call(h, stranger, 'GET', `/v1/workspaces/${w.id}`)).body);
    expect(seen).toMatchObject({ member: false, role: 'VIEWER', members: [], invites: [] });
    expect((await call(h, stranger, 'GET', `/v1/diagrams/${id}`)).status).toBe(200);
    expect((await call(h, stranger, 'GET', `/v1/workspaces/${w.id}/diagrams`)).status).toBe(200);
    // looking is all they can do
    const write = await call(h, stranger, 'POST', `/v1/diagrams/${id}/commands`, { expectedVersion: 1, command: { type: 'ADD_NODE', node: { name: 'X', kind: 'SERVICE' } } }, { 'idempotency-key': key() });
    expect(write.status).toBe(403);
    expect((await call(h, stranger, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'Mine' }, { 'idempotency-key': key() })).status).toBe(403);
    expect((await call(h, stranger, 'PATCH', `/v1/workspaces/${w.id}`, { visibility: 'PRIVATE' })).status).toBe(403);
    // not in their own list, and private again hides it
    expect(meResponseSchema.parse((await call(h, stranger, 'GET', '/v1/me')).body).workspaces.some((x) => x.id === w.id)).toBe(false);
    await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}`, { visibility: 'PRIVATE' });
    expect((await call(h, stranger, 'GET', `/v1/diagrams/${id}`)).status).toBe(404);
  });

  it('sharing: a person with an account is added at once; an unknown email is invited and joins when they first sign in', async () => {
    const w = await makeWorkspace('Sharing');
    const known = await h.newUser('ws-known');
    await visit(known);
    expect((await add(w.id, owner, emailOf(known), 'VIEWER')).body).toEqual({ status: 'ADDED' });
    expect((await add(w.id, owner, emailOf(known), 'VIEWER')).body.error.details.reason).toBe('ALREADY_MEMBER');

    const newcomer = await h.newUser('ws-newcomer');
    expect((await add(w.id, owner, emailOf(newcomer), 'EDITOR')).body).toEqual({ status: 'INVITED' });
    const pending = workspaceDetailSchema.parse((await call(h, owner, 'GET', `/v1/workspaces/${w.id}`)).body);
    expect(pending.invites).toEqual([{ email: emailOf(newcomer), role: 'EDITOR' }]);
    expect(workspaceDetailSchema.parse((await call(h, known, 'GET', `/v1/workspaces/${w.id}`)).body).invites).toEqual([]); // only owners see invites

    const joined = meResponseSchema.parse((await call(h, newcomer, 'GET', '/v1/me')).body); // first sign-in claims it
    expect(joined.workspaces.find((x) => x.id === w.id)).toMatchObject({ role: 'EDITOR' });
    expect(workspaceDetailSchema.parse((await call(h, owner, 'GET', `/v1/workspaces/${w.id}`)).body).invites).toEqual([]);
  });

  it('a pending invitation can be withdrawn, and bad input is refused', async () => {
    const w = await makeWorkspace('Withdraw');
    expect((await add(w.id, owner, 'someone.new@example.test')).body).toEqual({ status: 'INVITED' });
    expect((await call(h, owner, 'POST', `/v1/workspaces/${w.id}/invites/remove`, { email: 'someone.new@example.test' })).status).toBe(200);
    expect(workspaceDetailSchema.parse((await call(h, owner, 'GET', `/v1/workspaces/${w.id}`)).body).invites).toEqual([]);
    expect((await add(w.id, owner, 'not-an-email')).status).toBe(400);
    expect((await call(h, owner, 'POST', `/v1/workspaces/${w.id}/members`, { email: 'a@b.co', role: 'OWNER' })).status).toBe(400);
    expect((await add(w.id, null, 'a@b.co')).status).toBe(401);
  });

  it('roles can be changed and people removed by an owner; people can leave; an owner cannot be removed', async () => {
    const w = await makeWorkspace('Roles');
    const a = await h.newUser('ws-a');
    const b = await h.newUser('ws-b');
    await visit(a);
    await visit(b);
    await add(w.id, owner, emailOf(a), 'VIEWER');
    await add(w.id, owner, emailOf(b), 'VIEWER');
    const idOf = async (u: TestUser) => (meResponseSchema.parse((await call(h, u, 'GET', '/v1/me')).body)).user.id;
    const aId = await idOf(a);
    const ownerId = await idOf(owner);

    expect((await call(h, a, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'x' }, { 'idempotency-key': key() })).status).toBe(403);
    expect((await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}/members/${aId}`, { role: 'EDITOR' })).status).toBe(200);
    expect((await call(h, a, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'x' }, { 'idempotency-key': key() })).status).toBe(201); // now they can
    expect((await call(h, a, 'PATCH', `/v1/workspaces/${w.id}/members/${aId}`, { role: 'VIEWER' })).status).toBe(403); // not their call
    expect((await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}/members/${ownerId}`, { role: 'EDITOR' })).body.error.details.reason).toBe('OWNER_ROLE');
    expect((await call(h, owner, 'DELETE', `/v1/workspaces/${w.id}/members/${ownerId}`)).body.error.details.reason).toBe('OWNER_ROLE');

    expect((await call(h, a, 'DELETE', `/v1/workspaces/${w.id}/members/${await idOf(b)}`)).status).toBe(403); // an editor cannot remove others
    expect((await call(h, a, 'DELETE', `/v1/workspaces/${w.id}/members/${aId}`)).status).toBe(200); // but can leave
    expect((await call(h, a, 'GET', `/v1/workspaces/${w.id}`)).status).toBe(404);
    expect((await call(h, owner, 'DELETE', `/v1/workspaces/${w.id}/members/${await idOf(b)}`)).status).toBe(200);
    expect(workspaceDetailSchema.parse((await call(h, owner, 'GET', `/v1/workspaces/${w.id}`)).body).members).toHaveLength(1);
  });

  it('deleting needs the exact name and an owner; the diagrams go with it; the personal workspace cannot be deleted', async () => {
    const w = await makeWorkspace('Doomed');
    const made = await call(h, owner, 'POST', `/v1/workspaces/${w.id}/diagrams`, { name: 'Inside' }, { 'idempotency-key': key() });
    const editor = await h.newUser('ws-del-editor');
    await visit(editor);
    await add(w.id, owner, emailOf(editor), 'EDITOR');
    expect((await call(h, editor, 'DELETE', `/v1/workspaces/${w.id}`, { confirmName: 'Doomed' })).status).toBe(403);
    const wrong = await call(h, owner, 'DELETE', `/v1/workspaces/${w.id}`, { confirmName: 'doomed?' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.reason).toBe('NAME_MISMATCH');
    expect((await call(h, owner, 'DELETE', `/v1/workspaces/${w.id}`, { confirmName: 'Doomed' })).status).toBe(200);

    expect((await call(h, owner, 'GET', `/v1/workspaces/${w.id}`)).status).toBe(404);
    expect((await call(h, owner, 'GET', `/v1/diagrams/${made.body.diagramId}`)).status).toBe(404);
    expect((await call(h, editor, 'GET', `/v1/workspaces/${w.id}/diagrams`)).status).toBe(404);
    expect(meResponseSchema.parse((await call(h, owner, 'GET', '/v1/me')).body).workspaces.some((x) => x.id === w.id)).toBe(false);

    const personal = meResponseSchema.parse((await call(h, owner, 'GET', '/v1/me')).body).workspaces.find((x) => x.personal)!;
    const refused = await call(h, owner, 'DELETE', `/v1/workspaces/${personal.id}`, { confirmName: personal.name });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('PERSONAL_WORKSPACE');
  });

  it('the personal diagrams helper still works for the owner (no regression in access)', async () => {
    const { diagram } = await createDiagramFor(h, owner);
    expect((await call(h, owner, 'GET', `/v1/diagrams/${diagram.diagramId}`)).status).toBe(200);
  });
});
