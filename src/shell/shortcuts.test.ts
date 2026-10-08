import { describe, expect, it } from 'vitest';
import { anchorToward, edgeAnchors, spread } from '../diagram/edgeGeometry';
import { actionForKey, SHORTCUT_KEYS } from './shortcuts';

const press = (key: string, extra: Partial<Parameters<typeof actionForKey>[0]> = {}) => actionForKey({ key, metaKey: false, ctrlKey: false, altKey: false, typing: false, ...extra });

describe('single-key shortcuts', () => {
  it('maps the keys the person asked for', () => {
    expect(press('k')).toBe('fit');
    expect(press('c')).toBe('components');
    expect(press('r')).toBe('rename');
    expect(press('t')).toBe('text');
    expect(press('v')).toBe('select');
    expect(press('h')).toBe('pan');
    expect(press('g')).toBe('group');
    expect(press('f')).toBe('fullscreen');
    expect(press('K')).toBe('fit'); // capital letters work too (Caps Lock, Shift held)
  });

  it('never fires while typing in a box, or together with Ctrl, Cmd or Alt', () => {
    expect(press('k', { typing: true })).toBeNull();
    expect(press('r', { ctrlKey: true })).toBeNull(); // Ctrl+R is "reload"
    expect(press('c', { metaKey: true })).toBeNull(); // Cmd+C is "copy"
    expect(press('t', { altKey: true })).toBeNull();
  });

  it('ignores every other key, and every shortcut has exactly one key', () => {
    expect(press('x')).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press('Escape')).toBeNull();
    const keys = SHORTCUT_KEYS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('connection geometry: any side can be used', () => {
  const a = { x: 0, y: 0, width: 200, height: 100 };

  it('a component to the right is reached from the right side, one below from the bottom, and so on', () => {
    expect(anchorToward(a, { x: 600, y: 50 }).side).toBe('right');
    expect(anchorToward(a, { x: -400, y: 50 }).side).toBe('left');
    expect(anchorToward(a, { x: 100, y: 500 }).side).toBe('bottom');
    expect(anchorToward(a, { x: 100, y: -400 }).side).toBe('top');
  });

  it('the anchor lies on the border of the box', () => {
    for (const toward of [{ x: 600, y: 300 }, { x: -300, y: -200 }, { x: 150, y: 700 }, { x: 90, y: -250 }]) {
      const p = anchorToward(a, toward);
      const onVertical = Math.abs(p.x - 0) < 1e-6 || Math.abs(p.x - 200) < 1e-6;
      const onHorizontal = Math.abs(p.y - 0) < 1e-6 || Math.abs(p.y - 100) < 1e-6;
      expect(onVertical || onHorizontal).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(200 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it('stacked components connect bottom to top, side-by-side ones right to left', () => {
    const below = { x: 0, y: 300, width: 200, height: 100 };
    const right = { x: 500, y: 0, width: 200, height: 100 };
    expect(edgeAnchors(a, below)).toMatchObject({ from: { side: 'bottom' }, to: { side: 'top' } });
    expect(edgeAnchors(a, right)).toMatchObject({ from: { side: 'right' }, to: { side: 'left' } });
    expect(edgeAnchors(right, a)).toMatchObject({ from: { side: 'left' }, to: { side: 'right' } });
  });

  it('two connections between the same pair are pushed apart; a single one stays put', () => {
    const p = anchorToward(a, { x: 600, y: 50 });
    expect(spread(p, 0, 1)).toEqual(p);
    const first = spread(p, 0, 2);
    const second = spread(p, 1, 2);
    expect(second.y - first.y).toBe(14);
    expect((first.y + second.y) / 2).toBeCloseTo(p.y);
  });

  it('a degenerate case (same centre) does not produce NaN', () => {
    const p = anchorToward(a, { x: 100, y: 50 });
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
