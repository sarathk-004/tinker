import { LIMITS, type Note } from '../contracts';
import { session } from '../document/instance';

export const NOTE_DEFAULT_WIDTH = 240;
export const NOTE_PREFIX = 'note:';
export const isNoteNodeId = (id: string) => id.startsWith(NOTE_PREFIX);
export const noteNodeId = (id: string) => `${NOTE_PREFIX}${id}`;
export const noteIdOf = (nodeId: string) => nodeId.slice(NOTE_PREFIX.length);

export const newNote = (x: number, y: number, id: string = crypto.randomUUID()): Note => ({ id, x: Math.round(x), y: Math.round(y), text: '', width: NOTE_DEFAULT_WIDTH });

/** Pure list edits. The result always respects the saved limits, so a save is never refused for size. */
export function withNote(notes: readonly Note[], note: Note): Note[] {
  const next = notes.some((n) => n.id === note.id) ? notes.map((n) => (n.id === note.id ? note : n)) : [...notes, note];
  return next.slice(0, LIMITS.maxNotes).map((n) => ({ ...n, text: n.text.slice(0, LIMITS.maxNoteChars) }));
}
export const withoutNotes = (notes: readonly Note[], ids: ReadonlySet<string>): Note[] => notes.filter((n) => !ids.has(n.id));

const current = (): Note[] => session.getState().presentation.notes ?? [];

/** The notes of the open diagram, edited and saved (shown at once, saved with the next position save). */
export const noteActions = {
  add(x: number, y: number): Note | null {
    if (!session.getState().diagram || current().length >= LIMITS.maxNotes) return null;
    const note = newNote(x, y);
    session.saveExtras({ notes: withNote(current(), note) });
    return note;
  },
  update(id: string, patch: Partial<Omit<Note, 'id'>>): void {
    const existing = current().find((n) => n.id === id);
    if (existing) session.saveExtras({ notes: withNote(current(), { ...existing, ...patch }) });
  },
  remove(ids: Iterable<string>): void {
    session.saveExtras({ notes: withoutNotes(current(), new Set(ids)) });
  },
};
