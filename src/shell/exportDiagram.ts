import type { Graph, Presentation } from '../contracts';
import { renderCanvasImage } from './exportImage';

/** Everything an export needs: the saved document, never the editor's view of it. */
export interface ExportDoc {
  name: string;
  version: number;
  graph: Graph;
  presentation: Presentation;
}

/** A file name that is safe on every system and still recognisable. */
export function safeFileName(name: string, fallback = 'diagram'): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return cleaned || fallback;
}

const KIND_LABEL: Record<string, string> = { CLIENT: 'Client', GATEWAY: 'Gateway', SERVICE: 'Service', DATABASE: 'Database', CACHE: 'Cache', QUEUE: 'Queue', STORAGE: 'Storage', EXTERNAL: 'External', GENERIC: 'Component' };
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

export type ExportFormat = 'png' | 'png-solid' | 'svg' | 'json' | 'md';

/** What an image export needs from the canvas (the picture is taken from the real, rendered canvas). */
export type CanvasHandle = Parameters<typeof renderCanvasImage>[0];

export async function exportDiagram(doc: ExportDoc, format: ExportFormat, canvas: CanvasHandle): Promise<void> {
  const base = safeFileName(doc.name);
  if (format === 'json') return download(new Blob([toJson(doc)], { type: 'application/json' }), `${base}.json`);
  if (format === 'md') return download(new Blob([toMarkdown(doc)], { type: 'text/markdown' }), `${base}.md`);
  if (format === 'png-solid') return download(await renderCanvasImage(canvas, 'png', { solid: true }), `${base}.png`);
  return download(await renderCanvasImage(canvas, format), `${base}.${format}`);
}
