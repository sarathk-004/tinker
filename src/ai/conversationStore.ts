import { create } from 'zustand';
import type { ChatMessage, ConversationResponse } from '../contracts';

/**
 * What the Conversation tab shows. The server is the record (conversation + messages are persisted per diagram and user);
 * this store is a view of it plus transient entries (a message being sent, a local error) that are never persisted.
 */
export interface ConversationTurn {
  id: string;
  timestamp: number;
  role: 'user' | 'assistant';
  text: string;
  /** One line per applied edit ("Inserted Redis between Orders and PostgreSQL"). */
  actions?: string[];
  /** Suggestions from a clarification. Clicking one fills the command bar; nothing is sent automatically. */
  options?: string[];
  kind?: 'applied' | 'clarification' | 'refused' | 'error' | 'sending' | 'advice';
  source?: 'PARSER' | 'AI' | 'ANALYZER';
  /** The diagram version this turn produced or was answered against (from the saved message). */
  version?: number;
  /** Components an advice answer is about. "Show on diagram" highlights them (transient, never saved in the diagram). */
  highlight?: string[];
}

interface ConversationState {
  diagramId: string | null;
  conversationId: string | null;
  turns: ConversationTurn[];
  /** A typed command is in flight. */
  pending: boolean;
  /** Text to place in the command bar (set by suggestion chips). */
  draft: string;

  load(diagramId: string, conversation: ConversationResponse): void;
  append(turns: ConversationTurn[]): void;
  replaceLocal(localId: string, turns: ConversationTurn[], conversationId?: string): void;
  setPending(pending: boolean): void;
  setDraft(text: string): void;
  /** Forget everything (sign-out, or before another diagram loads). */
  reset(diagramId?: string | null): void;
  /** Clear the visible turns only; the saved conversation stays on the server. */
  hideAll(): void;
  /** Begin a new chat: the next message starts a fresh conversation. The earlier one stays in the history list. */
  startNew(): void;
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function messageToTurn(m: ChatMessage): ConversationTurn {
  const meta = (m.metadata ?? {}) as Record<string, unknown>;
  const status = asString(meta['status']);
  const options = Array.isArray(meta['options']) ? (meta['options'] as unknown[]).filter((o): o is string => typeof o === 'string') : undefined;
  const source = meta['source'] === 'PARSER' || meta['source'] === 'AI' || meta['source'] === 'ANALYZER' ? (meta['source'] as 'PARSER' | 'AI' | 'ANALYZER') : undefined;
  const highlight = Array.isArray(meta['highlight']) ? (meta['highlight'] as unknown[]).filter((o): o is string => typeof o === 'string') : undefined;
  return {
    id: m.id,
    timestamp: Date.parse(m.createdAt),
    role: m.role === 'USER' ? 'user' : 'assistant',
    text: m.content,
    ...(status === 'APPLIED' ? { kind: 'applied' as const } : status === 'CLARIFICATION' || status === 'PROPOSAL' ? { kind: 'clarification' as const } : status === 'REFUSED' ? { kind: 'refused' as const } : status === 'ADVICE' ? { kind: 'advice' as const } : {}),
    ...(highlight && highlight.length > 0 ? { highlight } : {}),
    ...(options && options.length > 0 ? { options } : {}),
    ...(source ? { source } : {}),
    ...(typeof meta['diagramVersion'] === 'number' ? { version: meta['diagramVersion'] as number } : {}),
  };
}

export const useConversationStore = create<ConversationState>((set) => ({
  diagramId: null,
  conversationId: null,
  turns: [],
  pending: false,
  draft: '',

  load: (diagramId, conversation) => set({ diagramId, conversationId: conversation.conversationId, turns: conversation.messages.map(messageToTurn) }),
  append: (turns) => set((s) => ({ turns: [...s.turns, ...turns] })),
  replaceLocal: (localId, turns, conversationId) =>
    set((s) => ({ turns: [...s.turns.filter((t) => t.id !== localId), ...turns], ...(conversationId ? { conversationId } : {}) })),
  setPending: (pending) => set({ pending }),
  setDraft: (draft) => set({ draft }),
  reset: (diagramId = null) => set({ diagramId, conversationId: null, turns: [], pending: false, draft: '' }),
  hideAll: () => set({ turns: [] }),
  startNew: () => set({ turns: [], conversationId: null, draft: '' }),
}));
