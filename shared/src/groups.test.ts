import { describe, expect, it } from 'vitest';
import { diagramCommandSchema } from './commands.ts';
import { groupChain, groupLabel, groupParent, groupPathSchema, groupSegments, isInGroup, normalizeGroupPath, renameInPath } from './groups.ts';

describe('group paths', () => {
  it('normalises what people type: parts joined by " / ", spaces collapsed, empty parts dropped', () => {
    expect(normalizeGroupPath('  AWS/eu-west-1 ')).toBe('AWS / eu-west-1');
    expect(normalizeGroupPath('Back   end //  Payments /')).toBe('Back end / Payments');
    expect(normalizeGroupPath('///')).toBe('');
    expect(normalizeGroupPath('Backend')).toBe('Backend');
  });

  it('reads a path: label, parent, chain, membership', () => {
    expect(groupSegments('A / B / C')).toEqual(['A', 'B', 'C']);
    expect(groupLabel('A / B / C')).toBe('C');
    expect(groupParent('A / B / C')).toBe('A / B');
    expect(groupParent('A')).toBe('');
    expect(groupChain('A / B / C')).toEqual(['A', 'A / B', 'A / B / C']);
    expect(groupChain(undefined)).toEqual([]);
    expect(isInGroup('A / B', 'A')).toBe(true);
    expect(isInGroup('A', 'A')).toBe(true);
    expect(isInGroup('AB', 'A')).toBe(false); // a longer name that merely starts with the same letters is a different group
    expect(isInGroup(undefined, 'A')).toBe(false);
  });

  it('moving a group renames its path prefix and leaves other groups alone', () => {
    expect(renameInPath('Payments', 'Payments', 'Backend / Payments')).toBe('Backend / Payments');
    expect(renameInPath('Payments / Cards', 'Payments', 'Backend / Payments')).toBe('Backend / Payments / Cards');
    expect(renameInPath('Paymentsx', 'Payments', 'Backend / Payments')).toBe('Paymentsx');
    expect(renameInPath('Other', 'Payments', 'X')).toBe('Other');
  });

  it('the contract accepts good paths and refuses bad ones', () => {
    for (const ok of ['Backend', 'AWS / eu-west-1', 'A / B / C / D']) expect(groupPathSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['', ' Backend', 'A//B', 'A / B / C / D / E', 'x'.repeat(41), 'A /  B']) expect(groupPathSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('SET_GROUP and RENAME_GROUP are valid commands; unknown fields are not', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(diagramCommandSchema.safeParse({ type: 'SET_GROUP', nodeIds: [id], group: 'Backend' }).success).toBe(true);
    expect(diagramCommandSchema.safeParse({ type: 'SET_GROUP', nodeIds: [id], group: null }).success).toBe(true);
    expect(diagramCommandSchema.safeParse({ type: 'SET_GROUP', nodeIds: [], group: 'x' }).success).toBe(false);
    expect(diagramCommandSchema.safeParse({ type: 'RENAME_GROUP', from: 'A', to: 'B / A' }).success).toBe(true);
    expect(diagramCommandSchema.safeParse({ type: 'RENAME_GROUP', from: 'A', to: 'B', extra: 1 }).success).toBe(false);
  });
});
