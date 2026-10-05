import type { ChatMessage } from '@tinker/shared';
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
