import { describe, expect, it } from 'vitest';
import { messageToTurn } from './conversationStore';
import { looksLikeQuestion } from './questions';

describe('looksLikeQuestion', () => {
  it('questions go to advice; commands and polite requests stay commands', () => {
    expect(looksLikeQuestion('What happens if Orders goes down?')).toBe(true);
    expect(looksLikeQuestion('  is the database a single point of failure?  ')).toBe(true);
    expect(looksLikeQuestion('Put Redis between Orders and PostgreSQL')).toBe(false);
    expect(looksLikeQuestion('can you add Redis between Orders and PostgreSQL?')).toBe(false);
    expect(looksLikeQuestion('Please add a cache?')).toBe(false);
    expect(looksLikeQuestion('')).toBe(false);
  });
});

describe('advice turns', () => {
  it('keep their source and the components to highlight', () => {
    const turn = messageToTurn({
      id: '00000000-0000-4000-8000-000000000001',
      role: 'ASSISTANT',
      content: 'Orders feeds PostgreSQL.',
      createdAt: '2026-10-06T10:00:00.000Z',
      metadata: { status: 'ADVICE', source: 'ANALYZER', highlight: ['a', 'b', 3] },
    });
    expect(turn).toMatchObject({ kind: 'advice', source: 'ANALYZER', highlight: ['a', 'b'] });
  });
});
