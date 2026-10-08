import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/modules/diagrams/domain/index.ts';
import { mkDoc, uid } from '../ai/helpers.ts';

const newId = () => '99999999-9999-4999-8999-999999999999';
const groupOf = (doc: { graph: { nodes: Array<{ id: string; metadata: Record<string, unknown> }> } }, n: number) => doc.graph.nodes.find((x) => x.id === uid(n))!.metadata['group'];

describe('groups', () => {
  const base = () => mkDoc(['A', 'B', 'C', 'D'], [['A', 'B']]);

  it('SET_GROUP puts components in a group in ONE command, and null takes them out', () => {
    const grouped = applyCommand(base(), { type: 'SET_GROUP', nodeIds: [uid(1), uid(2)], group: 'Backend' }, newId);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(groupOf(grouped.value, 1)).toBe('Backend');
    expect(groupOf(grouped.value, 2)).toBe('Backend');
    expect(groupOf(grouped.value, 3)).toBeUndefined();
    expect(grouped.value.graph.edges).toHaveLength(1); // the diagram's connections are untouched

    const freed = applyCommand(grouped.value, { type: 'SET_GROUP', nodeIds: [uid(1)], group: null }, newId);
    expect(freed.ok && groupOf(freed.value, 1)).toBeUndefined();
    expect(freed.ok && groupOf(freed.value, 2)).toBe('Backend');
  });

  it('keeps the rest of a component metadata when its group changes', () => {
    const doc = base();
    doc.graph.nodes[0]!.metadata = { icon: 'ec2', description: 'Takes orders' };
    const r = applyCommand(doc, { type: 'SET_GROUP', nodeIds: [uid(1)], group: 'Backend' }, newId);
    expect(r.ok && r.value.graph.nodes[0]!.metadata).toEqual({ icon: 'ec2', description: 'Takes orders', group: 'Backend' });
  });

  it('an unknown component is refused and nothing changes', () => {
    const r = applyCommand(base(), { type: 'SET_GROUP', nodeIds: [uid(1), uid(77)], group: 'Backend' }, newId);
    expect(r).toMatchObject({ ok: false, error: { reason: 'NODE_NOT_FOUND' } });
  });

  it('RENAME_GROUP renames a group and everything inside it; moving a group inside another is a rename', () => {
    let doc = base();
    for (const [ids, group] of [[[uid(1), uid(2)], 'Payments'], [[uid(3)], 'Payments / Cards'], [[uid(4)], 'Other']] as const) {
      const r = applyCommand(doc, { type: 'SET_GROUP', nodeIds: [...ids], group }, newId);
      if (!r.ok) throw new Error('setup');
      doc = r.value;
    }
    const moved = applyCommand(doc, { type: 'RENAME_GROUP', from: 'Payments', to: 'Backend / Payments' }, newId);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(groupOf(moved.value, 1)).toBe('Backend / Payments');
    expect(groupOf(moved.value, 3)).toBe('Backend / Payments / Cards');
    expect(groupOf(moved.value, 4)).toBe('Other');
  });

  it('renaming into an existing group merges them; a missing group and a move into itself are refused', () => {
    let doc = base();
    for (const [ids, group] of [[[uid(1)], 'X'], [[uid(2)], 'Y']] as const) {
      const r = applyCommand(doc, { type: 'SET_GROUP', nodeIds: [...ids], group }, newId);
      if (!r.ok) throw new Error('setup');
      doc = r.value;
    }
    const merged = applyCommand(doc, { type: 'RENAME_GROUP', from: 'X', to: 'Y' }, newId);
    expect(merged.ok && groupOf(merged.value, 1)).toBe('Y');
    expect(applyCommand(doc, { type: 'RENAME_GROUP', from: 'Nope', to: 'Z' }, newId)).toMatchObject({ ok: false, error: { reason: 'GROUP_NOT_FOUND' } });
    expect(applyCommand(doc, { type: 'RENAME_GROUP', from: 'X', to: 'X / Inner' }, newId)).toMatchObject({ ok: false, error: { reason: 'GROUP_NOT_FOUND' } });
  });
});
