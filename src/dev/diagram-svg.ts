/** Tiny SVG renderer shared by the development preview pages. Not part of the production app. */
import type { Graph, Presentation } from '../contracts';

const NODE_W = 220;
const NODE_H = 90;
const NS = 'http://www.w3.org/2000/svg';

export function renderDiagram(svg: SVGSVGElement, doc: { graph: Graph; presentation: Presentation } | null, highlight: ReadonlySet<string> = new Set()) {
  svg.innerHTML = '';
  if (!doc || doc.graph.nodes.length === 0) {
    svg.setAttribute('viewBox', '0 0 600 120');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '300');
    t.setAttribute('y', '64');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#6b6a60');
    t.textContent = doc ? 'Empty diagram: add a node' : 'No diagram loaded';
    svg.appendChild(t);
    return;
  }
  const pos = doc.presentation.nodePositions;
  const xs = doc.graph.nodes.map((n) => pos[n.id]?.x ?? 0);
  const ys = doc.graph.nodes.map((n) => pos[n.id]?.y ?? 0);
  const minX = Math.min(...xs) - 30;
  const minY = Math.min(...ys) - 30;
  svg.setAttribute('viewBox', `${minX} ${minY} ${Math.max(...xs) + NODE_W + 30 - minX} ${Math.max(...ys) + NODE_H + 30 - minY}`);

  const make = (tag: string, attrs: Record<string, string>, text?: string) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  svg.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#26251e"/></marker></defs>';

  for (const edge of doc.graph.edges) {
    const s = pos[edge.sourceNodeId];
    const t = pos[edge.targetNodeId];
    if (!s || !t) continue;
    const x1 = s.x + NODE_W, y1 = s.y + NODE_H / 2, x2 = t.x, y2 = t.y + NODE_H / 2;
    svg.appendChild(make('path', { class: 'edge', d: `M${x1} ${y1} C${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`, 'marker-end': 'url(#arrow)' }));
    if (edge.relationship) svg.appendChild(make('text', { class: 'edge-label', x: String((x1 + x2) / 2), y: String((y1 + y2) / 2 - 6), 'text-anchor': 'middle' }, edge.relationship));
  }
  for (const node of doc.graph.nodes) {
    const p = pos[node.id];
    if (!p) continue;
    const g = make('g', { class: `node${highlight.has(node.id) ? ' new' : ''}`, transform: `translate(${p.x} ${p.y})` });
    g.appendChild(make('rect', { width: String(NODE_W), height: String(NODE_H) }));
    g.appendChild(make('text', { class: 'name', x: '14', y: '36' }, node.name));
    g.appendChild(make('text', { class: 'meta', x: '14', y: '58' }, `${node.kind}${node.technology ? ' · ' + node.technology : ''}`));
    svg.appendChild(g);
  }
}
