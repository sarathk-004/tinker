import { describe, expect, it } from 'vitest';
import { autoPreset, coverView, COVER_PRESETS } from './covers';

describe('covers', () => {
  it('an automatic cover is stable for a project and varies between projects', () => {
    expect(autoPreset('a').id).toBe(autoPreset('a').id);
    const seen = new Set(Array.from({ length: 40 }, (_, i) => autoPreset(`project-${i}`).id));
    expect(seen.size).toBeGreaterThan(3);
  });
  it('shows the chosen cover, or the drawing when asked, or an automatic one', () => {
    expect(coverView({ id: 'p', cover: 'ember', latestDiagram: null })).toMatchObject({ kind: 'preset', preset: { id: 'ember' } });
    expect(coverView({ id: 'p', cover: 'preview', latestDiagram: null })).toEqual({ kind: 'preview' });
    expect(coverView({ id: 'p', cover: null, latestDiagram: { id: 'd' } }).kind).toBe('preview');
    expect(coverView({ id: 'p', cover: null, latestDiagram: null }).kind).toBe('preset');
  });
  it('every preset has two different colours', () => {
    for (const p of COVER_PRESETS) expect(p.from).not.toBe(p.to);
  });
});
