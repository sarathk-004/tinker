import type { Graph, GraphNode, Presentation } from '../contracts';

/** Everything an export needs: the saved document, never the editor's view of it. */
export interface ExportDoc {
  name: string;
  version: number;
  graph: Graph;
  presentation: Presentation;
}

export const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** A file name that is safe on every system and still recognisable. */
export function safeFileName(name: string, fallback = 'diagram'): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return cleaned || fallback;
}

const KIND_LABEL: Record<string, string> = { CLIENT: 'Client', GATEWAY: 'Gateway', SERVICE: 'Service', DATABASE: 'Database', CACHE: 'Cache', QUEUE: 'Queue', STORAGE: 'Storage', EXTERNAL: 'External', GENERIC: 'Component' };
const KIND_COLOR: Record<string, string> = { CLIENT: '#807d72', GATEWAY: '#9fbbe0', SERVICE: '#cfcdc4', DATABASE: '#9fc9a2', CACHE: '#dfa88f', QUEUE: '#c08532', STORAGE: '#c0a8dd', EXTERNAL: '#a09c92', GENERIC: '#cfcdc4' };
const kindLabel = (k: string) => KIND_LABEL[k] ?? 'Component';

export function toJson(doc: ExportDoc): string {
  return `${JSON.stringify({ name: doc.name, version: doc.version, graph: doc.graph, presentation: doc.presentation }, null, 2)}\n`;
}

/** Names are the user's text: neutralise anything Markdown would act on (tags, emphasis, table bars) and keep it on one line. */
const md = (s: string) => s.replace(/\r?\n/g, ' ').replace(/([\\`*_{}[\]<>|#])/g, '\\$1');
const cell = md;

/** A readable summary to paste into a document, a pull request or a wiki. */
export function toMarkdown(doc: ExportDoc): string {
  const byId = new Map(doc.graph.nodes.map((n) => [n.id, n]));
  const lines: string[] = [`# ${md(doc.name)}`, '', `${doc.graph.nodes.length} components, ${doc.graph.edges.length} connections (version ${doc.version}).`, ''];
  if (doc.graph.nodes.length > 0) {
    lines.push('## Components', '', '| Component | Kind | Technology | Group |', '| --- | --- | --- | --- |');
    for (const n of doc.graph.nodes) {
      const group = typeof n.metadata['group'] === 'string' ? (n.metadata['group'] as string) : '';
      lines.push(`| ${cell(n.name)} | ${kindLabel(n.kind)} | ${cell(n.technology ?? '')} | ${cell(group)} |`);
    }
    lines.push('');
  }
  if (doc.graph.edges.length > 0) {
    lines.push('## Connections', '');
    for (const e of doc.graph.edges) {
      const from = byId.get(e.sourceNodeId)?.name ?? 'Unknown';
      const to = byId.get(e.targetNodeId)?.name ?? 'Unknown';
      lines.push(`- ${md(from)} → ${md(to)}${e.relationship ? ` (${md(e.relationship)})` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

const NODE_W = 232;
const NODE_H = 76;
const PAD = 48;

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
}

function place(doc: ExportDoc): Placed[] {
  // Saved positions where there are any; otherwise a simple grid so that nothing overlaps.
  return doc.graph.nodes.map((node, i) => {
    const p = doc.presentation.nodePositions[node.id];
    return { node, x: p?.x ?? (i % 4) * (NODE_W + 56), y: p?.y ?? Math.floor(i / 4) * (NODE_H + 72) };
  });
}

/** Where the line from a box's centre toward a point leaves the box. */
function edgePoint(box: Placed, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + NODE_W / 2;
  const cy = box.y + NODE_H / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(NODE_W / 2 / Math.abs(dx || 1e-9), NODE_H / 2 / Math.abs(dy || 1e-9));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A self-contained SVG of the diagram (no external fonts or images), in the same look as the app. */
export function toSvg(doc: ExportDoc): { svg: string; width: number; height: number } {
  const placed = place(doc);
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const minX = Math.min(0, ...placed.map((p) => p.x));
  const minY = Math.min(0, ...placed.map((p) => p.y));
  const maxX = Math.max(NODE_W, ...placed.map((p) => p.x + NODE_W));
  const maxY = Math.max(NODE_H, ...placed.map((p) => p.y + NODE_H));
  const width = Math.ceil(maxX - minX + PAD * 2);
  const height = Math.ceil(maxY - minY + PAD * 2 + 28);
  const ox = PAD - minX;
  const oy = PAD + 28 - minY;

  const edges = doc.graph.edges
    .map((e) => {
      const a = byId.get(e.sourceNodeId);
      const b = byId.get(e.targetNodeId);
      if (!a || !b) return '';
      const start = edgePoint(a, { x: b.x + NODE_W / 2, y: b.y + NODE_H / 2 });
      const end = edgePoint(b, { x: a.x + NODE_W / 2, y: a.y + NODE_H / 2 });
      const mx = (start.x + end.x) / 2 + ox;
      const my = (start.y + end.y) / 2 + oy;
      const label = e.relationship
        ? `<g><rect x="${mx - (e.relationship.length * 3.6 + 8)}" y="${my - 9}" width="${e.relationship.length * 7.2 + 16}" height="18" rx="9" fill="#f7f7f4"/><text x="${mx}" y="${my + 4}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="10.5" fill="#5a5852">${escapeXml(clip(e.relationship, 24))}</text></g>`
        : '';
      return `<line x1="${start.x + ox}" y1="${start.y + oy}" x2="${end.x + ox}" y2="${end.y + oy}" stroke="#a09c92" stroke-width="1.6" marker-end="url(#arrow)"/>${label}`;
    })
    .join('');

  const nodes = placed
    .map(({ node, x, y }) => {
      const px = x + ox;
      const py = y + oy;
      const color = KIND_COLOR[node.kind] ?? '#cfcdc4';
      const category = (node.technology ?? kindLabel(node.kind)).toUpperCase();
      return (
        `<g><rect x="${px}" y="${py}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="#ffffff" stroke="#e6e5e0"/>` +
        `<rect x="${px + 14}" y="${py + 14}" width="8" height="8" rx="2" fill="${color}"/>` +
        `<text x="${px + 28}" y="${py + 22}" font-family="JetBrains Mono, ui-monospace, monospace" font-size="9.5" letter-spacing="0.6" fill="#807d72">${escapeXml(clip(category, 26))}</text>` +
        `<text x="${px + 14}" y="${py + 46}" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" fill="#26251e">${escapeXml(clip(node.name, 24))}</text>` +
        `<text x="${px + 14}" y="${py + 64}" font-family="JetBrains Mono, ui-monospace, monospace" font-size="10" fill="#807d72">${escapeXml(clip(typeof node.metadata['description'] === 'string' ? (node.metadata['description'] as string) : kindLabel(node.kind), 32))}</text></g>`
      );
    })
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#a09c92"/></marker></defs>` +
    `<rect width="100%" height="100%" fill="#f7f7f4"/>` +
    `<text x="${PAD}" y="${PAD - 6}" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="600" fill="#26251e">${escapeXml(clip(doc.name, 70))}</text>` +
    `${edges}${nodes}</svg>`;
  return { svg, width, height };
}

/** Rasterise the SVG in the browser (no libraries). `scale` 2 gives a sharp image on high-density screens. */
export async function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The diagram could not be drawn as an image.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Images are not available in this browser.');
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be created.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ExportFormat = 'png' | 'svg' | 'json' | 'md';

export async function exportDiagram(doc: ExportDoc, format: ExportFormat): Promise<void> {
  const base = safeFileName(doc.name);
  if (format === 'json') return download(new Blob([toJson(doc)], { type: 'application/json' }), `${base}.json`);
  if (format === 'md') return download(new Blob([toMarkdown(doc)], { type: 'text/markdown' }), `${base}.md`);
  const { svg, width, height } = toSvg(doc);
  if (format === 'svg') return download(new Blob([svg], { type: 'image/svg+xml' }), `${base}.svg`);
  return download(await svgToPngBlob(svg, width, height), `${base}.png`);
}
