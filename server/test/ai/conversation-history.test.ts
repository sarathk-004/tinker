import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationListResponseSchema, conversationResponseSchema } from '@tinker/shared';
import { aiCmd, call, createDiagramFor, startHarness, type Harness, type TestUser } from '../support/harness.ts';

describe('chat history', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('historian');
  });
  afterAll(() => h.close());

  const list = (user: TestUser | null, id: string) => call(h, user, 'GET', `/v1/diagrams/${id}/conversations`);

  it('lists earlier chats newest first, titled by what the person said first, and opens any of them', async () => {
    const { diagram } = await createDiagramFor(h, u, 'History');
    const id = diagram.diagramId as string;
    expect(conversationListResponseSchema.parse((await list(u, id)).body).conversations).toEqual([]);

    const first = await aiCmd(h, u, id, diagram.version, 'add Orders');
    const firstChat = first.body.conversationId as string;
    // A second chat: no conversationId, so a fresh conversation starts.
    const second = await aiCmd(h, u, id, first.body.diagram.version, 'add PostgreSQL');
    const secondChat = second.body.conversationId as string;
    expect(secondChat).not.toBe(firstChat);

    const chats = conversationListResponseSchema.parse((await list(u, id)).body).conversations;
    expect(chats.map((c) => c.title)).toEqual(['add PostgreSQL', 'add Orders']);
    expect(chats.every((c) => c.messageCount === 2)).toBe(true);

    const opened = conversationResponseSchema.parse((await call(h, u, 'GET', `/v1/diagrams/${id}/conversations/${firstChat}`)).body);
    expect(opened.conversationId).toBe(firstChat);
    expect(opened.messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
    expect(opened.messages[0]!.content).toBe('add Orders');
  });

  it('long first messages are shortened for the title, and chats with no messages are not listed', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Long');
    const long = `remove ${'b'.repeat(120)}`; // an unknown component: answered with a question, which is stored like any turn
    await aiCmd(h, u, diagram.diagramId, diagram.version, long);
    const chats = (await list(u, diagram.diagramId)).body.conversations;
    expect(chats).toHaveLength(1);
    expect(chats[0].title.length).toBeLessThanOrEqual(80);
    expect(chats[0].title.endsWith('…')).toBe(true);
  });

  it('nobody else can list or open your chats, and a chat cannot be opened through a different diagram', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Private chats');
    const made = await aiCmd(h, u, diagram.diagramId, diagram.version, 'add Orders');
    const chat = made.body.conversationId as string;
    const other = await h.newUser('snoop');
    expect((await list(other, diagram.diagramId)).status).toBe(404);
    expect((await call(h, other, 'GET', `/v1/diagrams/${diagram.diagramId}/conversations/${chat}`)).status).toBe(404);

    const { diagram: mine2 } = await createDiagramFor(h, u, 'Another');
    expect((await call(h, u, 'GET', `/v1/diagrams/${mine2.diagramId}/conversations/${chat}`)).status).toBe(404);
    expect((await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}/conversations/not-a-uuid`)).status).toBe(400);
    expect((await list(null, diagram.diagramId)).status).toBe(401);
  });
});
