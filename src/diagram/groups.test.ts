import { describe, expect, it } from 'vitest';
import { computeGroupBoxes, freshGroupName, innermostBoxAt, regroupAfterDrag, reparentAfterGroupDrag, sharedParentGroup, type PlacedNode } from './groups';

const n = (id: string, x: number, y: number, group?: string): PlacedNode => ({ id, x, y, ...(group ? { group } : {}) });

describe('group boxes', () => {
  const nodes = [n('a', 0, 0, 'Backend'), n('b', 300, 0, 'Backend'), n('c', 0, 300, 'Backend / Payments'), n('d', 800, 0)];

  it('one box per group, around its members (also those in nested groups); components in no group have none', () => {
    const boxes = computeGroupBoxes(nodes);
    expect(boxes.map((b) => b.path)).toEqual(['Backend', 'Backend / Payments']);
    const backend = boxes[0]!;
    expect([...backend.memberIds].sort()).toEqual(['a', 'b', 'c']);
    expect(backend.label).toBe('Backend');
    expect(backend.childPaths).toEqual(['Backend / Payments']);
    expect(boxes[1]!.memberIds).toEqual(['c']);
    expect(boxes[1]!.label).toBe('Payments');
  });

  it('an outer box fully contains an inner one, which is drawn on top (greater depth)', () => {
    const [outer, inner] = computeGroupBoxes(nodes);
    expect(inner!.depth).toBeGreaterThan(outer!.depth);
    expect(inner!.x).toBeGreaterThanOrEqual(outer!.x);
    expect(inner!.y).toBeGreaterThanOrEqual(outer!.y);
    expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width);
    expect(inner!.y + inner!.height).toBeLessThanOrEqual(outer!.y + outer!.height);
  });

  it('leaving a component out of the calculation shrinks the box (used to judge a drag)', () => {
    const withB = computeGroupBoxes(nodes)[0]!;
    const withoutB = computeGroupBoxes(nodes, new Set(['b']))[0]!;
    expect(withoutB.width).toBeLessThan(withB.width);
    expect(computeGroupBoxes(nodes, new Set(['a', 'b', 'c']))).toEqual([]);
  });

  it('innermostBoxAt prefers the deepest box and returns null outside every box', () => {
    const boxes = computeGroupBoxes(nodes);
    expect(innermostBoxAt(boxes, { x: 100, y: 350 })?.path).toBe('Backend / Payments');
    expect(innermostBoxAt(boxes, { x: 330, y: 20 })?.path).toBe('Backend');
    expect(innermostBoxAt(boxes, { x: 5000, y: 5000 })).toBeNull();
  });
});

describe('dragging components between groups', () => {
  it('a component dropped inside a box joins it, and one dragged clear of its box leaves it', () => {
    const all = [n('a', 0, 0, 'Backend'), n('b', 300, 0, 'Backend'), n('x', 120, 20)]; // x was dropped on top of the Backend box
    expect(regroupAfterDrag(all, ['x'])).toEqual([{ group: 'Backend', nodeIds: ['x'] }]);

    const out = [n('a', 0, 0, 'Backend'), n('b', 300, 0, 'Backend'), n('b2', 2000, 2000, 'Backend')];
    const moved = regroupAfterDrag(out, ['b2']); // b2 was dragged far away from the others
    expect(moved).toEqual([{ group: null, nodeIds: ['b2'] }]);
  });

  it('a component that stays inside its own box changes nothing; several dragged together become one command per target', () => {
    const all = [n('a', 0, 0, 'Backend'), n('b', 300, 0, 'Backend'), n('c', 150, 20, 'Backend')];
    expect(regroupAfterDrag(all, ['c'])).toEqual([]);
    const two = [n('a', 0, 0, 'G'), n('b', 300, 0, 'G'), n('p', 100, 10), n('q', 200, 10)];
    expect(regroupAfterDrag(two, ['p', 'q'])).toEqual([{ group: 'G', nodeIds: ['p', 'q'] }]);
  });

  it('dropping into a nested box picks the innermost group', () => {
    const all = [n('a', 0, 0, 'A'), n('b', 0, 400, 'A / B'), n('c', 5, 405, 'A / B'), n('x', 10, 410)];
    expect(regroupAfterDrag(all, ['x'])[0]).toEqual({ group: 'A / B', nodeIds: ['x'] });
  });
});

describe('dragging a whole group', () => {
  it('dropped onto another group it moves inside it; dropped clear of everything it moves back to the top', () => {
    const all = [n('a', 0, 0, 'Backend'), n('b', 300, 0, 'Backend'), n('p', 40, 20, 'Payments')];
    const paymentsBox = { x: 40 - 26, y: 20 - 26 - 30, width: 232 + 52, height: 104 + 52 + 30 };
    expect(reparentAfterGroupDrag(all, 'Payments', paymentsBox)).toBe('Backend / Payments');

    const nested = [n('a', 0, 0, 'Backend'), n('p', 4000, 4000, 'Backend / Payments')];
    const far = { x: 4000 - 26, y: 4000 - 56, width: 284, height: 186 };
    expect(reparentAfterGroupDrag(nested, 'Backend / Payments', far)).toBe('Payments');
  });

  it('a group can never land inside itself, and a group left where it is changes nothing', () => {
    const all = [n('a', 0, 0, 'Backend'), n('p', 40, 400, 'Backend / Payments')];
    const box = { x: 0, y: 0, width: 400, height: 400 };
    expect(reparentAfterGroupDrag(all, 'Backend', box)).toBeNull();
    expect(reparentAfterGroupDrag([n('a', 0, 0, 'Solo')], 'Solo', { x: 0, y: 0, width: 300, height: 200 })).toBeNull();
  });
});

describe('naming', () => {
  it('a fresh name avoids siblings that already exist', () => {
    expect(freshGroupName([], '')).toBe('New group');
    expect(freshGroupName(['New group'], '')).toBe('New group 2');
    expect(freshGroupName(['New group', 'New group 2'], '')).toBe('New group 3');
    expect(freshGroupName(['A / New group'], 'A')).toBe('New group 2');
    expect(freshGroupName(['A / New group'], '')).toBe('New group');
  });

  it('new groups live inside the group all the selected components share', () => {
    expect(sharedParentGroup(['A', 'A', 'A'])).toBe('A');
    expect(sharedParentGroup(['A', 'B'])).toBe('');
    expect(sharedParentGroup([undefined, undefined])).toBe('');
    expect(sharedParentGroup([])).toBe('');
  });
});
