import { describe, expect, it } from 'vitest';
import { emptyGraph, emptyPresentation, type Graph } from '../contracts';
import { safeFileName, toJson, toMarkdown, type ExportDoc } from './exportDiagram';
import { dataUrlToBlob } from './exportImage';
import { rankItems, scoreText, type PaletteItem } from './search';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function doc(): ExportDoc {
  const graph: Graph = {
    ...emptyGraph(),
    nodes: [
      { id: id(1), name: 'Web & <Client>', kind: 'CLIENT', metadata: {} },
      { id: id(2), name: 'Orders', kind: 'SERVICE', technology: 'Node.js', metadata: { group: 'Backend', description: 'Takes orders' } },
      { id: id(3), name: 'PostgreSQL', kind: 'DATABASE', technology: 'PostgreSQL', metadata: {} },
    ],
    edges: [
      { id: id(101), sourceNodeId: id(1), targetNodeId: id(2), relationship: 'HTTPS', metadata: {} },
      { id: id(102), sourceNodeId: id(2), targetNodeId: id(3), metadata: {} },
    ],
  };
  return { name: 'Order system: v2/final?', version: 7, graph, presentation: { ...emptyPresentation(), nodePositions: { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 320, y: 0 }, [id(3)]: { x: 640, y: 0 } } } };
}

describe('palette search', () => {
  const item = (title: string, group: PaletteItem['group'] = 'Diagrams', extra: Partial<PaletteItem> = {}): PaletteItem => ({ id: title, group, title, run: () => undefined, ...extra });

  it('ranks whole-word and prefix matches above looser ones, and ignores case and accents', () => {
    expect(scoreText('Orders', 'orders')).toBeGreaterThan(scoreText('Reorders', 'orders'));
    expect(scoreText('Order History', 'ord')).toBeGreaterThan(scoreText('Reorder', 'ord'));
    expect(scoreText('Café Menu', 'cafe')).toBeGreaterThan(0);
  });

  it('every typed word has to match something', () => {
    expect(scoreText('Orders database', 'orders data')).toBeGreaterThan(0);
    expect(scoreText('Orders', 'orders data')).toBe(0);
  });

  it('finds by letters in order ("pgsql") but only for three letters or more', () => {
    expect(scoreText('PostgreSQL', 'pgsql')).toBeGreaterThan(0);
    expect(scoreText('PostgreSQL', 'pq')).toBe(0);
  });

  it('puts the best match first, searches the small print at half weight, and keeps natural order for an empty query', () => {
    const items = [item('Billing'), item('Orders'), item('Reorders flow'), item('Notes', 'Diagrams', { subtitle: 'about orders' })];
    expect(rankItems(items, 'orders').map((i) => i.title)).toEqual(['Orders', 'Reorders flow', 'Notes']);
    expect(rankItems(items, '').map((i) => i.title)).toEqual(['Billing', 'Orders', 'Reorders flow', 'Notes']);
    expect(rankItems(items, 'zzz')).toEqual([]);
  });

  it('loose (letters-in-order) matching applies to names only, so small print cannot match everything', () => {
    const items = [{ id: 'a', group: 'Actions' as const, title: 'New diagram', subtitle: 'Start an empty diagram in this workspace', run: () => undefined }];
    expect(rankItems(items, 'redis')).toEqual([]);
    expect(rankItems(items, 'diagram')).toHaveLength(1);
  });

  it('breaks ties by group order, and caps the list', () => {
    const items = [item('Cache', 'Actions'), item('Cache', 'Components'), item('Cache', 'Diagrams')];
    expect(rankItems(items, 'cache').map((i) => i.group)).toEqual(['Diagrams', 'Components', 'Actions']);
    expect(rankItems(Array.from({ length: 40 }, (_, n) => item(`Item ${n}`)), '', 10)).toHaveLength(10);
  });
});

describe('export', () => {
  it('file names are safe and never empty', () => {
    expect(safeFileName('Order system: v2/final?')).toBe('Order-system-v2final');
    expect(safeFileName('////')).toBe('diagram');
    expect(safeFileName('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it('JSON is the saved document, round-trippable', () => {
    const parsed = JSON.parse(toJson(doc()));
    expect(parsed).toMatchObject({ name: 'Order system: v2/final?', version: 7 });
    expect(parsed.graph.nodes).toHaveLength(3);
  });

  it('Markdown lists components and connections, and cannot be broken by a "|" in a name', () => {
    const d = doc();
    d.graph.nodes[1]!.name = 'Orders | API';
    const md = toMarkdown(d);
    expect(md).toContain('# Order system: v2/final?');
    expect(md).toContain('3 components, 2 connections (version 7)');
    expect(md).toContain(String.raw`| Orders \| API | Service | Node.js | Backend |`);
    expect(md).toContain(String.raw`- Web & \<Client\> → Orders \| API (HTTPS)`);
    expect(md).not.toContain('<Client>');
    expect(md).toContain(String.raw`- Orders \| API → PostgreSQL`);
  });

  it('an empty diagram still exports', () => {
    const empty: ExportDoc = { name: 'Empty', version: 1, graph: emptyGraph(), presentation: emptyPresentation() };
    expect(toMarkdown(empty)).toContain('0 components, 0 connections');
  });
});

describe('image data', () => {
  it('turns a data address into a Blob without fetching it (base64 and plain forms)', async () => {
    const b64 = dataUrlToBlob(`data:image/png;base64,${btoa('PNGDATA')}`);
    expect(b64.type).toBe('image/png');
    expect(await b64.text()).toBe('PNGDATA');
    const plain = dataUrlToBlob(`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg a="1"/>')}`);
    expect(plain.type).toBe('image/svg+xml');
    expect(await plain.text()).toBe('<svg a="1"/>');
  });
});
