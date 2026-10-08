import { describe, expect, it } from 'vitest';
import { LIMITS, type Note } from '../contracts';
import { planLayoutSwitch } from './layoutMemory';
import { newNote, withNote, withoutNotes } from './notes';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = [id(1), id(2)];
const lr = { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 300, y: 0 } };
const tb = { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 0, y: 200 } };
const fresh = (dir: 'LR' | 'TB') => (dir === 'LR' ? lr : tb);

describe('layout memory: LR, TB, LR returns to the same picture', () => {
  it('leaving a direction remembers the arrangement, and coming back restores it exactly', () => {
    const dragged = { [id(1)]: { x: 11, y: 22 }, [id(2)]: { x: 333, y: 44 } }; // the person moved things around in LR
    const toTb = planLayoutSwitch({ currentDir: 'LR', targetDir: 'TB', ids, current: dragged, layouts: undefined, fresh });
    expect(toTb.positions).toEqual(tb); // nothing remembered for TB yet: computed fresh
    expect(toTb.layouts.LR).toEqual(dragged);

    const back = planLayoutSwitch({ currentDir: 'TB', targetDir: 'LR', ids, current: toTb.positions, layouts: toTb.layouts, fresh });
    expect(back.positions).toEqual(dragged); // exactly as left, not recomputed
    expect(back.layouts.TB).toEqual(tb);

    const again = planLayoutSwitch({ currentDir: 'LR', targetDir: 'TB', ids, current: back.positions, layouts: back.layouts, fresh });
    expect(again.positions).toEqual(tb);
  });

  it('the same direction again is a tidy: a fresh arrangement, memory untouched', () => {
    const r = planLayoutSwitch({ currentDir: 'LR', targetDir: 'LR', ids, current: { [id(1)]: { x: 9, y: 9 }, [id(2)]: { x: 5, y: 5 } }, layouts: { TB: tb }, fresh });
    expect(r.positions).toEqual(lr);
    expect(r.layouts).toEqual({ TB: tb });
  });

  it('a remembered arrangement that no longer covers every component is not used (new component since), and removed ones are ignored', () => {
    const stale = { [id(1)]: { x: 1, y: 1 } };
    expect(planLayoutSwitch({ currentDir: 'LR', targetDir: 'TB', ids, current: lr, layouts: { TB: stale }, fresh }).positions).toEqual(tb);
    const extra = { ...tb, [id(9)]: { x: 7, y: 7 } };
    const r = planLayoutSwitch({ currentDir: 'LR', targetDir: 'TB', ids, current: lr, layouts: { TB: extra }, fresh });
    expect(Object.keys(r.positions).sort()).toEqual([...ids].sort());
  });
});

describe('notes', () => {
  it('adds, edits and removes without touching the others, and never exceeds the saved limits', () => {
    const a = newNote(10.4, 20.6, id(1));
    expect(a).toMatchObject({ x: 10, y: 21, text: '' });
    let notes: Note[] = withNote([], a);
    notes = withNote(notes, { ...a, text: 'hello' });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('hello');
    notes = withNote(notes, newNote(0, 0, id(2)));
    expect(withoutNotes(notes, new Set([id(1)])).map((n) => n.id)).toEqual([id(2)]);
    expect(withNote([], { ...a, text: 'x'.repeat(LIMITS.maxNoteChars + 50) })[0]!.text).toHaveLength(LIMITS.maxNoteChars);
    const many = Array.from({ length: LIMITS.maxNotes }, (_, i) => newNote(i, i, `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`));
    expect(withNote(many, newNote(1, 1, id(500)))).toHaveLength(LIMITS.maxNotes);
  });
});
