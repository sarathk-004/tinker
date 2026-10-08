import { describe, expect, it } from 'vitest';
import { diagramIconSchema } from '../contracts';
import { DEFAULT_ICON, ICONS, ICON_COLORS, joinIcon, parseIcon, searchIcons } from './diagramIcons';

describe('diagram icons', () => {
  it('has a generous list with unique names, each of which the server accepts in every colour', () => {
    expect(ICONS.length).toBeGreaterThan(120);
    expect(new Set(ICONS.map((i) => i.name)).size).toBe(ICONS.length);
    for (const i of ICONS) for (const c of ICON_COLORS) expect(diagramIconSchema.safeParse(joinIcon(i.name, c.id)).success, i.name).toBe(true);
  });
  it('reads a stored value, and falls back quietly on anything unknown', () => {
    expect(parseIcon('Rocket.violet')).toMatchObject({ entry: { name: 'Rocket' }, color: { id: 'violet' } });
    expect(parseIcon(null).entry.name).toBe(parseIcon(DEFAULT_ICON).entry.name);
    expect(parseIcon('Nope.pink')).toMatchObject({ entry: { name: 'TreeStructure' }, color: { id: 'slate' } });
  });
  it('searches by name and by group', () => {
    expect(searchIcons('rock').map((i) => i.name)).toContain('Rocket');
    expect(searchIcons('security').length).toBeGreaterThan(5);
    expect(searchIcons('zzzzz')).toEqual([]);
    expect(searchIcons('')).toHaveLength(ICONS.length);
  });
});
