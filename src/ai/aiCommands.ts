import { ApiError } from '../api/client';
import { api, session } from '../document/instance';
import { ConflictError, RefusedError, SessionClosedError } from '../document/session';
import { messageToTurn, useConversationStore, type ConversationTurn } from './conversationStore';

/** What the user sees when a typed command did not go through. Server messages are already user-facing. */
export function describeAiError(error: unknown): string {
  if (error instanceof ConflictError) return "The diagram was changed in another tab or device, so your command was not applied. See the banner above to continue.";
  if (error instanceof RefusedError) return error.message;
  if (error instanceof SessionClosedError) return error.message;
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') return 'You are sending commands too quickly. Please wait a moment and try again.';
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') return 'Cannot reach the server right now. Your command was not applied.';
    return error.message;
  }
  return 'Something went wrong. Your diagram was not changed.';
}

const localTurn = (role: 'user' | 'assistant', text: string, kind: ConversationTurn['kind']): ConversationTurn => ({
  id: `local-${crypto.randomUUID()}`,
  timestamp: Date.now(),
  role,
  text,
  ...(kind ? { kind } : {}),
});

/**
 * Send a typed command. It travels through the document session like every other write (serialized, idempotent, bound to the
 * version on screen) and the server either applies it atomically, asks a clarifying question, or explains why it could not.
 * Returns true when the command was understood (applied or a question asked).
 */
export async function submitAiCommand(text: string): Promise<boolean> {
  const trimmed = text.trim();
  const convo = useConversationStore.getState();
  const diagramId = session.getState().diagram?.id;
  if (!trimmed || convo.pending || !diagramId) return false;

  const sending = localTurn('user', trimmed, 'sending');
  convo.setPending(true);
  convo.append([sending]);
  try {
    const res = await session.ai(trimmed, convo.conversationId ?? undefined);
    if (useConversationStore.getState().diagramId !== diagramId) return true; // the user moved to another diagram meanwhile
    const turns = res.messages.map(messageToTurn);
    if (res.status === 'APPLIED') {
      const last = turns[turns.length - 1];
      if (last) last.actions = res.interpretation.commands.map((c) => c.summary);
    }
    useConversationStore.getState().replaceLocal(sending.id, turns, res.conversationId);
    return true;
  } catch (error) {
    if (useConversationStore.getState().diagramId === diagramId) {
      useConversationStore.getState().append([localTurn('assistant', describeAiError(error), 'error')]);
    }
    return false;
  } finally {
    useConversationStore.getState().setPending(false);
  }
}

/** Load the saved conversation for a diagram (call after opening or creating one). Failures leave an empty history. */
export async function syncConversation(diagramId: string): Promise<void> {
  useConversationStore.getState().reset(diagramId);
  try {
    const conversation = await api.conversation(diagramId);
    if (useConversationStore.getState().diagramId === diagramId) useConversationStore.getState().load(diagramId, conversation);
  } catch {
    /* history is a convenience: the editor works without it */
  }
}
