import { describe, expect, it } from 'vitest';
import { snapBox, type Box } from './snap';

const box = (x: number, y: number, width = 220, height = 90): Box => ({ x, y, width, height });

describe('snapping while dragging', () => {
  it('snaps to a nearby top edge and draws a horizontal guide across both boxes', () => {
    const r = snapBox(box(500, 103), [box(100, 100)], 8);
    expect(r.y).toBe(100);
    expect(r.x).toBe(500); // nothing close horizontally
    expect(r.guides.horizontal).toEqual([{ y: 100, x1: 100, x2: 720 }]);
    expect(r.guides.vertical).toEqual([]);
  });

  it('snaps centres to each other (a box dragged under another lines up in the middle)', () => {
    const r = snapBox(box(95, 300, 120, 90), [box(100, 100, 220, 90)], 8);
    // centre of the dragged box is 155, the other's is 210: too far; its left edge (95) is within 8 of 100
    expect(r.x).toBe(100);
    const centred = snapBox(box(146, 300, 128, 90), [box(100, 100, 220, 90)], 8); // centre 210 vs 210
    expect(centred.x).toBe(146);
    expect(centred.guides.vertical[0]?.x).toBe(210);
  });

  it('does nothing when nothing is within reach', () => {
    const r = snapBox(box(400, 400), [box(100, 100)], 8);
    expect(r).toEqual({ x: 400, y: 400, guides: { vertical: [], horizontal: [] } });
  });

  it('takes the closest line when several are in reach, and snaps both axes at once', () => {
    const r = snapBox(box(103, 98), [box(100, 100)], 8);
    expect([r.x, r.y]).toEqual([100, 100]);
    expect(r.guides.vertical.length).toBeGreaterThan(0);
    expect(r.guides.horizontal.length).toBeGreaterThan(0);
  });

  it('lines up a right edge with another box left edge', () => {
    const r = snapBox(box(0, 300, 100, 50), [box(104, 100, 220, 90)], 8); // right edge 100 vs left edge 104
    expect(r.x).toBe(4);
  });
});
