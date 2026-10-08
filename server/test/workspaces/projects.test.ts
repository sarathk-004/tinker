import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diagramCardsResponseSchema, diagramDetailSchema, meResponseSchema, projectListResponseSchema, projectSummarySchema } from '@tinker/shared';
import { call, key, startHarness, type Harness, type TestUser } from '../support/harness.ts';

describe('projects: workspace -> project -> diagram', () => {
  let h: Harness;
  let owner: TestUser;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    owner = await h.newUser('proj-owner');
  });

  const workspace = async (name = 'Team') => (await call(h, owner, 'POST', '/v1/workspaces', { name }, { 'idempotency-key': key() })).body as { id: string; projectCount: number };
  const projects = async (wid: string, u: TestUser = owner) => projectListResponseSchema.parse((await call(h, u, 'GET', `/v1/workspaces/${wid}/projects`)).body).projects;
  const newDiagram = (wid: string, name: string, projectId?: string, u: TestUser = owner) =>
    call(h, u, 'POST', `/v1/workspaces/${wid}/diagrams`, { name, ...(projectId ? { projectId } : {}) }, { 'idempotency-key': key() });

  it('every workspace starts with a General project, and new diagrams go there unless another is chosen', async () => {
    const w = await workspace();
    expect(w.projectCount).toBe(1);
    const [general] = await projects(w.id);
    expect(general).toMatchObject({ name: 'General', diagramCount: 0 });
    const d = diagramDetailSchema.parse((await newDiagram(w.id, 'First')).body);
    expect(d.projectId).toBe(general!.id);

    const made = projectSummarySchema.parse((await call(h, owner, 'POST', `/v1/workspaces/${w.id}/projects`, { name: 'Payments', description: 'Money movement' })).body);
    expect(made).toMatchObject({ name: 'Payments', description: 'Money movement', diagramCount: 0 });
    const inPayments = diagramDetailSchema.parse((await newDiagram(w.id, 'Checkout', made.id)).body);
    expect(inPayments.projectId).toBe(made.id);
    expect((await projects(w.id)).map((p) => [p.name, p.diagramCount])).toEqual([['General', 1], ['Payments', 1]]);
    expect(meResponseSchema.parse((await call(h, owner, 'GET', '/v1/me')).body).workspaces.find((x) => x.id === w.id)!.projectCount).toBe(2);
  });

  it('the personal workspace has a project from the first sign-in', async () => {
    const me = meResponseSchema.parse((await call(h, owner, 'GET', '/v1/me')).body);
    const personal = me.workspaces.find((x) => x.personal)!;
    expect(personal.projectCount).toBe(1);
    expect((await projects(personal.id)).map((p) => p.name)).toEqual(['General']);
  });

  it('a diagram cannot be put in a project of another workspace; diagrams can be moved between projects', async () => {
    const a = await workspace('A');
    const b = await workspace('B');
    const [aGeneral] = await projects(a.id);
    const [bGeneral] = await projects(b.id);
    const refused = await newDiagram(a.id, 'Wrong', bGeneral!.id);
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('PROJECT_NOT_FOUND');

    const second = projectSummarySchema.parse((await call(h, owner, 'POST', `/v1/workspaces/${a.id}/projects`, { name: 'Second' })).body);
    const d = diagramDetailSchema.parse((await newDiagram(a.id, 'Movable')).body);
    expect((await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/move`, { projectId: second.id })).status).toBe(200);
    expect(diagramDetailSchema.parse((await call(h, owner, 'GET', `/v1/diagrams/${d.diagramId}`)).body)).toMatchObject({ projectId: second.id, version: d.version });
    expect((await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/move`, { projectId: bGeneral!.id })).status).toBe(422);
    expect((await projects(a.id)).map((p) => [p.name, p.diagramCount])).toEqual([['General', 0], ['Second', 1]]);
    expect(aGeneral!.name).toBe('General');
  });

  it('project pages and the recent list give cards with counts and a drawing of the layout', async () => {
    const w = await workspace('Cards');
    const [general] = await projects(w.id);
    const d = diagramDetailSchema.parse((await newDiagram(w.id, 'Sketch')).body);
    const a = await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/commands`, { expectedVersion: d.version, command: { type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE' }, position: { x: 10, y: 20 } } }, { 'idempotency-key': key() });
    const orders = a.body.graph.nodes[0].id as string;
    const b = await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/commands`, { expectedVersion: a.body.version, command: { type: 'ADD_NODE', node: { name: 'DB', kind: 'DATABASE' }, position: { x: 300, y: 20 } } }, { 'idempotency-key': key() });
    const db = b.body.graph.nodes[1].id as string;
    await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/commands`, { expectedVersion: b.body.version, command: { type: 'CONNECT', sourceNodeId: orders, targetNodeId: db } }, { 'idempotency-key': key() });

    const page = diagramCardsResponseSchema.parse((await call(h, owner, 'GET', `/v1/projects/${general!.id}/diagrams`)).body);
    expect(page.diagrams).toHaveLength(1);
    expect(page.diagrams[0]).toMatchObject({ name: 'Sketch', nodeCount: 2, edgeCount: 1, workspaceName: 'Cards', projectName: 'General' });
    expect(page.diagrams[0]!.preview.nodes).toHaveLength(2);
    expect(page.diagrams[0]!.preview.edges).toEqual([[0, 1]]);
    const recent = diagramCardsResponseSchema.parse((await call(h, owner, 'GET', '/v1/diagrams-recent')).body);
    expect(recent.diagrams[0]!.id).toBe(d.diagramId);
  });

  it('rename, describe and delete: viewers cannot change; only owners delete; the last project stays; a deleted project takes its diagrams', async () => {
    const w = await workspace('Rules');
    const viewer = await h.newUser('proj-viewer');
    await call(h, viewer, 'GET', '/v1/me');
    await call(h, owner, 'POST', `/v1/workspaces/${w.id}/members`, { email: `${viewer.subject}@example.test`, role: 'VIEWER' });
    const extra = projectSummarySchema.parse((await call(h, owner, 'POST', `/v1/workspaces/${w.id}/projects`, { name: 'Extra' })).body);
    const inside = diagramDetailSchema.parse((await newDiagram(w.id, 'Inside', extra.id)).body);

    expect((await call(h, viewer, 'POST', `/v1/workspaces/${w.id}/projects`, { name: 'Nope' })).status).toBe(403);
    expect((await call(h, viewer, 'PATCH', `/v1/projects/${extra.id}`, { name: 'Nope' })).status).toBe(403);
    expect((await projects(w.id, viewer)).map((p) => p.name)).toContain('Extra'); // viewers can look
    const renamed = await call(h, owner, 'PATCH', `/v1/projects/${extra.id}`, { name: 'Renamed', description: 'About' });
    expect(projectSummarySchema.parse(renamed.body)).toMatchObject({ name: 'Renamed', description: 'About' });
    expect((await call(h, owner, 'PATCH', `/v1/projects/${extra.id}`, {})).status).toBe(400);

    expect((await call(h, viewer, 'DELETE', `/v1/projects/${extra.id}`)).status).toBe(403);
    expect((await call(h, owner, 'DELETE', `/v1/projects/${extra.id}`)).status).toBe(200);
    expect((await call(h, owner, 'GET', `/v1/diagrams/${inside.diagramId}`)).status).toBe(404);
    const [general] = await projects(w.id);
    const last = await call(h, owner, 'DELETE', `/v1/projects/${general!.id}`);
    expect(last.status).toBe(422);
    expect(last.body.error.details.reason).toBe('LAST_PROJECT');
  });

  it('outsiders see nothing of a private workspace; projects respect its limits', async () => {
    const w = await workspace('Hidden');
    const [general] = await projects(w.id);
    const stranger = await h.newUser('proj-stranger');
    expect((await call(h, stranger, 'GET', `/v1/workspaces/${w.id}/projects`)).status).toBe(404);
    expect((await call(h, stranger, 'GET', `/v1/projects/${general!.id}/diagrams`)).status).toBe(404);
    expect((await call(h, stranger, 'PATCH', `/v1/projects/${general!.id}`, { name: 'x' })).status).toBe(404);
    expect((await call(h, owner, 'POST', `/v1/workspaces/${w.id}/projects`, { name: '' })).status).toBe(400);
    expect((await call(h, null, 'GET', `/v1/workspaces/${w.id}/projects`)).status).toBe(401);
  });

  it('a project carries a cover and the diagram it was last worked on', async () => {
    const w = await workspace('Covers');
    const [general] = await projects(w.id);
    expect(general).toMatchObject({ cover: null, latestDiagram: null });
    const older = diagramDetailSchema.parse((await newDiagram(w.id, 'Older')).body);
    const newer = diagramDetailSchema.parse((await newDiagram(w.id, 'Newer')).body);
    const [after] = await projects(w.id);
    expect(after!.latestDiagram).toMatchObject({ id: newer.diagramId, name: 'Newer' });
    await call(h, owner, 'POST', `/v1/diagrams/${older.diagramId}/commands`, { expectedVersion: older.version, command: { type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE' } } }, { 'idempotency-key': key() });
    expect((await projects(w.id))[0]!.latestDiagram).toMatchObject({ id: older.diagramId }); // editing makes it the latest
    const set = await call(h, owner, 'PATCH', `/v1/projects/${general!.id}`, { cover: 'dusk' });
    expect(projectSummarySchema.parse(set.body).cover).toBe('dusk');
    expect(projectSummarySchema.parse((await call(h, owner, 'PATCH', `/v1/projects/${general!.id}`, { cover: null })).body).cover).toBeNull();
    expect((await call(h, owner, 'PATCH', `/v1/projects/${general!.id}`, { cover: 'not-a-cover' })).status).toBe(400);
  });

  it('a diagram has an icon that can be set, changed and cleared, and a workspace has a cover', async () => {
    const w = await workspace('Icons');
    const d = diagramDetailSchema.parse((await newDiagram(w.id, 'Iconic')).body);
    expect(d.icon).toBeNull();
    expect((await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/icon`, { icon: 'Rocket.violet' })).status).toBe(200);
    const loaded = diagramDetailSchema.parse((await call(h, owner, 'GET', `/v1/diagrams/${d.diagramId}`)).body);
    expect(loaded).toMatchObject({ icon: 'Rocket.violet', version: d.version }); // an icon is not a new version
    const [general] = await projects(w.id);
    const cards = diagramCardsResponseSchema.parse((await call(h, owner, 'GET', `/v1/projects/${general!.id}/diagrams`)).body);
    expect(cards.diagrams[0]!.icon).toBe('Rocket.violet');
    expect((await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/icon`, { icon: 'not an icon' })).status).toBe(400);
    expect((await call(h, owner, 'POST', `/v1/diagrams/${d.diagramId}/icon`, { icon: null })).status).toBe(200);
    expect(diagramDetailSchema.parse((await call(h, owner, 'GET', `/v1/diagrams/${d.diagramId}`)).body).icon).toBeNull();
    const stranger = await h.newUser('icon-stranger');
    expect((await call(h, stranger, 'POST', `/v1/diagrams/${d.diagramId}/icon`, { icon: 'Rocket.blue' })).status).toBe(404);

    const set = await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}`, { cover: 'ocean' });
    expect(set.body.cover).toBe('ocean');
    expect((await call(h, owner, 'PATCH', `/v1/workspaces/${w.id}`, { cover: 'nope' })).status).toBe(400);
    expect(meResponseSchema.parse((await call(h, owner, 'GET', '/v1/me')).body).workspaces.find((x) => x.id === w.id)!.cover).toBe('ocean');
  });
});
