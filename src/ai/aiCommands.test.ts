import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { ConflictError, RefusedError } from '../document/session';
import { describeAiError } from './aiCommands';
import { messageToTurn, useConversationStore } from './conversationStore';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const message = (n: number, role: 'USER' | 'ASSISTANT', content: string, metadata?: Record<string, string | Array<string | number>>) => ({
  id: U(n),
  role,
  content,
  createdAt: '2026-01-01T00:00:0' + n + '.000Z',
  ...(metadata ? { metadata } : {}),
});

describe('conversation mapping', () => {
  beforeEach(() => useConversationStore.getState().reset());

  it('maps server messages to turns: roles, kinds, sources and clarification options', () => {
    const applied = messageToTurn(message(1, 'ASSISTANT', 'Added Redis.', { status: 'APPLIED', source: 'PARSER' }));
    expect(applied).toMatchObject({ role: 'assistant', text: 'Added Redis.', kind: 'applied', source: 'PARSER' });
    const clarify = messageToTurn(message(2, 'ASSISTANT', 'Which one?', { status: 'CLARIFICATION', source: 'AI', options: ['A', 'B', 7] }));
    expect(clarify).toMatchObject({ kind: 'clarification', source: 'AI', options: ['A', 'B'] });
    expect(messageToTurn(message(3, 'USER', 'hello'))).toMatchObject({ role: 'user', text: 'hello' });
    expect(messageToTurn(message(4, 'ASSISTANT', 'No.', { status: 'REFUSED' })).kind).toBe('refused');
  });

  it('loads a saved conversation in order and replaces a local "sending" turn with the server turns', () => {
    const store = useConversationStore.getState();
    store.load(U(9), { conversationId: U(7), messages: [message(1, 'USER', 'add Redis'), message(2, 'ASSISTANT', 'Added Redis.', { status: 'APPLIED' })] });
    expect(useConversationStore.getState()).toMatchObject({ diagramId: U(9), conversationId: U(7) });
    expect(useConversationStore.getState().turns.map((t) => t.text)).toEqual(['add Redis', 'Added Redis.']);

    store.append([{ id: 'local-1', timestamp: 1, role: 'user', text: 'next', kind: 'sending' }]);
    store.replaceLocal('local-1', [messageToTurn(message(3, 'USER', 'next')), messageToTurn(message(4, 'ASSISTANT', 'Done.'))], U(7));
    expect(useConversationStore.getState().turns.map((t) => t.id)).toEqual([U(1), U(2), U(3), U(4)]);
  });

  it('hiding clears the view only; reset forgets the diagram too', () => {
    const store = useConversationStore.getState();
    store.load(U(9), { conversationId: U(7), messages: [message(1, 'USER', 'x')] });
    store.hideAll();
    expect(useConversationStore.getState().turns).toEqual([]);
    expect(useConversationStore.getState().conversationId).toBe(U(7));
    store.reset();
    expect(useConversationStore.getState()).toMatchObject({ diagramId: null, conversationId: null });
  });
});

describe('error messages for typed commands', () => {
  it('uses the server wording for refusals and provider failures, and plain language for the rest', () => {
    expect(describeAiError(new RefusedError('These nodes are already connected.'))).toBe('These nodes are already connected.');
    expect(describeAiError(new ApiError('AI_TIMEOUT', "Couldn't interpret that command. Your diagram hasn't changed.", 504))).toBe("Couldn't interpret that command. Your diagram hasn't changed.");
    expect(describeAiError(new ApiError('RATE_LIMITED', 'x', 429))).toContain('too quickly');
    expect(describeAiError(new ApiError('NETWORK_ERROR', 'x', 0, undefined, undefined, true))).toContain('Cannot reach the server');
    expect(describeAiError(new ConflictError())).toContain('another tab');
    expect(describeAiError(new Error('boom'))).toContain('not changed');
    expect(describeAiError(new Error('secret internals'))).not.toContain('secret internals');
  });
});
