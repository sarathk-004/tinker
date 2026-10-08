import type { ChatMessage, ConversationListResponse } from '@tinker/shared';
import type { Queryable } from '../../../infrastructure/database/pool.ts';
import type { HistoryTurn } from '../application/prompt.ts';

/** A conversation belongs to ONE user and ONE diagram; both are checked on every use (decision D07). */
export async function conversationBelongsTo(db: Queryable, conversationId: string, diagramId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM conversations WHERE id = $1 AND diagram_id = $2 AND user_id = $3`, [conversationId, diagramId, userId]);
  return rows.length > 0;
}

export async function createConversation(db: Queryable, diagramId: string, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO conversations (diagram_id, user_id) VALUES ($1, $2) RETURNING id`, [diagramId, userId]);
  return rows[0]!.id;
}

/** Newest turns first in SQL, returned oldest first for prompting. */
export async function recentTurns(db: Queryable, conversationId: string, limit: number): Promise<HistoryTurn[]> {
  const { rows } = await db.query<{ role: 'USER' | 'ASSISTANT'; content: string }>(
    `SELECT role, content FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [conversationId, limit],
  );
  return rows.reverse();
}

/** The newest ASSISTANT message of a conversation (its metadata may hold a pending proposal). */
export async function latestAssistantMessage(db: Queryable, conversationId: string): Promise<{ id: string; metadata: unknown } | null> {
  const { rows } = await db.query<{ id: string; metadata: unknown }>(
    `SELECT id, metadata FROM conversation_messages WHERE conversation_id = $1 AND role = 'ASSISTANT' ORDER BY created_at DESC, id DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

/** The text of an ASSISTANT message, only when it sits in the caller's own conversation for this diagram. */
export async function assistantMessageText(db: Queryable, messageId: string, diagramId: string, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ content: string }>(
    `SELECT m.content FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND m.role = 'ASSISTANT' AND c.diagram_id = $2 AND c.user_id = $3`,
    [messageId, diagramId, userId],
  );
  return rows[0]?.content ?? null;
}

interface NewMessage {
  role: 'USER' | 'ASSISTANT';
  content: string;
  metadata?: Record<string, unknown>;
}

/** Insert in order with clock_timestamp() (now() would give both rows of one transaction the same time). */
export async function appendMessages(db: Queryable, conversationId: string, messages: NewMessage[]): Promise<ChatMessage[]> {
  const saved: ChatMessage[] = [];
  for (const m of messages) {
    const { rows } = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO conversation_messages (conversation_id, role, content, metadata, created_at)
       VALUES ($1, $2, $3, $4::jsonb, clock_timestamp()) RETURNING id, created_at`,
      [conversationId, m.role, m.content, JSON.stringify(m.metadata ?? {})],
    );
    const row = rows[0]!;
    saved.push({ id: row.id, role: m.role, content: m.content, createdAt: row.created_at.toISOString(), ...(m.metadata ? { metadata: m.metadata as ChatMessage['metadata'] } : {}) });
  }
  await db.query(`UPDATE conversations SET updated_at = clock_timestamp() WHERE id = $1`, [conversationId]);
  return saved;
}

const TITLE_CHARS = 80;

/** The caller's chats about a diagram, newest first (only ones that have messages). The title is their first message, shortened. */
export async function listConversations(db: Queryable, diagramId: string, userId: string, limit = 50): Promise<ConversationListResponse> {
  const { rows } = await db.query<{ id: string; updated_at: Date; title: string | null; n: number }>(
    `SELECT c.id, c.updated_at,
            (SELECT m.content FROM conversation_messages m WHERE m.conversation_id = c.id AND m.role = 'USER' ORDER BY m.created_at ASC, m.id ASC LIMIT 1) AS title,
            (SELECT count(*)::int FROM conversation_messages m WHERE m.conversation_id = c.id) AS n
       FROM conversations c
      WHERE c.diagram_id = $1 AND c.user_id = $2
        AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id)
      ORDER BY c.updated_at DESC, c.id
      LIMIT $3`,
    [diagramId, userId, limit],
  );
  return {
    conversations: rows.map((r) => {
      const text = (r.title ?? 'Conversation').replace(/\s+/g, ' ').trim();
      return { id: r.id, title: text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1).trimEnd()}…` : text, updatedAt: r.updated_at.toISOString(), messageCount: r.n };
    }),
  };
}

/** One of the caller's conversations for this diagram (null when it is not theirs or not about this diagram), oldest message first. */
export async function getConversation(db: Queryable, conversationId: string, diagramId: string, userId: string, limit = 200): Promise<{ conversationId: string; messages: ChatMessage[] } | null> {
  if (!(await conversationBelongsTo(db, conversationId, diagramId, userId))) return null;
  const { rows } = await db.query<{ id: string; role: 'USER' | 'ASSISTANT'; content: string; metadata: Record<string, unknown>; created_at: Date }>(
    `SELECT id, role, content, metadata, created_at FROM (
        SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
     ) t ORDER BY created_at ASC, id ASC`,
    [conversationId, limit],
  );
  return {
    conversationId,
    messages: rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at.toISOString(), metadata: r.metadata as ChatMessage['metadata'] })),
  };
}

/** The caller's most recent conversation for a diagram, oldest message first (capped). */
export async function latestConversation(db: Queryable, diagramId: string, userId: string, limit = 50): Promise<{ conversationId: string | null; messages: ChatMessage[] }> {
  const conv = await db.query<{ id: string }>(
    `SELECT id FROM conversations WHERE diagram_id = $1 AND user_id = $2 ORDER BY updated_at DESC, id LIMIT 1`,
    [diagramId, userId],
  );
  const id = conv.rows[0]?.id;
  if (!id) return { conversationId: null, messages: [] };
  const { rows } = await db.query<{ id: string; role: 'USER' | 'ASSISTANT'; content: string; metadata: Record<string, unknown>; created_at: Date }>(
    `SELECT id, role, content, metadata, created_at FROM (
        SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
     ) t ORDER BY created_at ASC, id ASC`,
    [id, limit],
  );
  return {
    conversationId: id,
    messages: rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at.toISOString(), metadata: r.metadata as ChatMessage['metadata'] })),
  };
}
