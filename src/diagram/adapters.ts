/**
 * Canonical document <-> editor (React Flow) view model. React Flow types never define what is stored (architecture invariant):
 * the canonical graph and presentation are the source; these functions only derive what the canvas draws.
 */
import { MarkerType, Position as HandlePosition } from '@xyflow/react';
import {
  NODE_KIND_FROM_LEGACY,
  type DiagramCommand,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  type Presentation,
} from '../contracts';
import type { AWSServiceIcon, DiagramEdge, DiagramNode, DiagramNodeData, SystemNodeType } from '../types/diagram';
import { inferAWSDetails, sanitizeLabel } from './inference';

const KNOWN_ICONS: ReadonlySet<string> = new Set<AWSServiceIcon>([
  'client', 'api-gateway', 'alb', 'ec2', 'lambda', 'ecs', 'eks', 'rds', 'dynamodb', 'elasticache', 'redis', 'sqs', 'sns', 's3',
  'cloudfront', 'cognito', 'route53', 'waf', 'eventbridge', 'kinesis', 'opensearch', 'secrets-manager', 'step-functions', 'generic',
]);

export const kindToType = (kind: NodeKind): SystemNodeType => kind.toLowerCase() as SystemNodeType;
export const typeToKind = (type: SystemNodeType): NodeKind => NODE_KIND_FROM_LEGACY[type] ?? 'GENERIC';

type Metadata = GraphNode['metadata'];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** Canonical node -> the fields the node card renders. The icon is metadata.icon (user choice) else inferred from the name. */
export function toNodeData(node: GraphNode): DiagramNodeData {
  const type = kindToType(node.kind);
  const icon = str(node.metadata['icon']);
  const awsIcon = (icon && KNOWN_ICONS.has(icon) ? icon : inferAWSDetails(node.name, type).awsIcon) as AWSServiceIcon;
  const description = str(node.metadata['description']);
  const group = str(node.metadata['group']);
  return {
    id: node.id,
    label: node.name,
    type,
    awsIcon,
    ...(node.technology ? { subType: node.technology } : {}),
    ...(description ? { description } : {}),
    ...(group ? { group } : {}),
  };
}

export interface ViewContext {
  layoutDir: 'LR' | 'TB';
  highlightedIds: readonly string[];
}

/** Selection is owned by React Flow (it merges its own `selected` flags back in), so it is not part of the derived view. */
export function toViewNodes(graph: Graph, presentation: Presentation, ctx: ViewContext): DiagramNode[] {
  const highlighted = new Set(ctx.highlightedIds);
  const anyHighlight = highlighted.size > 0;
  return graph.nodes.map((node) => ({
    id: node.id,
    type: 'awsNode' as const,
    position: presentation.nodePositions[node.id] ?? { x: 0, y: 0 },
    targetPosition: ctx.layoutDir === 'LR' ? HandlePosition.Left : HandlePosition.Top,
    sourcePosition: ctx.layoutDir === 'LR' ? HandlePosition.Right : HandlePosition.Bottom,
    data: { ...toNodeData(node), isHighlighted: highlighted.has(node.id), isDimmed: anyHighlight && !highlighted.has(node.id) },
  }));
}

/** Connections are quiet: a solid mid-grey line that only turns orange (and moves) when it is part of what is being shown. */
const INK = '#a09c92';

export function toViewEdges(graph: Graph, highlightedIds: readonly string[]): DiagramEdge[] {
  const highlighted = new Set(highlightedIds);
  // Connections between the same two components (either direction) share a pair key, so they can be drawn side by side instead of on top of each other.
  const pairKey = (e: GraphEdge) => [e.sourceNodeId, e.targetNodeId].sort().join('|');
  const pairCount = new Map<string, number>();
  for (const e of graph.edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);
  const pairSeen = new Map<string, number>();
  return graph.edges.map((edge) => {
    const lit = highlighted.has(edge.sourceNodeId) && highlighted.has(edge.targetNodeId);
    const dim = highlighted.size > 0 && !lit;
    const bidirectional = edge.metadata['bidirectional'] === true;
    const key = pairKey(edge);
    const index = pairSeen.get(key) ?? 0;
    pairSeen.set(key, index + 1);
    const color = lit ? '#f54e00' : dim ? '#9a988f' : INK;
    return {
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      ...(edge.relationship ? { label: edge.relationship } : {}),
      type: 'floating',
      data: { index, count: pairCount.get(key) ?? 1 },
      animated: lit,
      style: { stroke: color, strokeWidth: lit ? 2.25 : 1.5, opacity: dim ? 0.3 : 1 },
      labelStyle: { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 10.5, fill: lit ? 'rgb(var(--primary-hover))' : 'rgb(var(--body))', letterSpacing: '0.02em' },
      labelBgStyle: { fill: 'rgb(var(--canvas))', fillOpacity: 1 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      ...(bidirectional ? { markerStart: { type: MarkerType.Arrow, width: 14, height: 14, color } } : {}),
      markerEnd: { type: MarkerType.Arrow, width: 14, height: 14, color },
    };
  });
}

/** What the UI knows when it creates a node. The server assigns the id; the icon travels in metadata (decision D06). */
export interface NewNodeSpec {
  label: string;
  type?: SystemNodeType;
  awsIcon?: AWSServiceIcon;
  subType?: string;
  description?: string;
  /** Where to put it (canvas coordinates); without one the server picks a free spot. */
  position?: { x: number; y: number };
}

export function newNodeFields(spec: NewNodeSpec) {
  const label = sanitizeLabel(spec.label);
  const inferred = inferAWSDetails(label, spec.type);
  const type = spec.type ?? inferred.type;
  const awsIcon = spec.awsIcon ?? inferred.awsIcon;
  const technology = (spec.subType ?? inferred.subType).trim().slice(0, 120);
  return {
    name: label.slice(0, 120),
    kind: typeToKind(type),
    ...(technology ? { technology } : {}),
    metadata: { icon: awsIcon, ...(spec.description ? { description: spec.description.slice(0, 500) } : {}) } as Metadata,
  };
}

export const addNodeCommand = (spec: NewNodeSpec): Extract<DiagramCommand, { type: 'ADD_NODE' }> => ({
  type: 'ADD_NODE',
  node: newNodeFields(spec),
  ...(spec.position ? { position: { x: Math.round(spec.position.x), y: Math.round(spec.position.y) } } : {}),
});

export const insertBetweenCommand = (
  sourceNodeId: string,
  targetNodeId: string,
  spec: NewNodeSpec,
  edgeId?: string,
): Extract<DiagramCommand, { type: 'INSERT_BETWEEN' }> => ({
  type: 'INSERT_BETWEEN',
  sourceNodeId,
  targetNodeId,
  ...(edgeId ? { edgeId } : {}),
  node: newNodeFields(spec),
});

/** Edit-modal changes -> the minimal commands (rename and update are separate commands in the contract). */
export function nodeEditCommands(
  node: GraphNode,
  edit: { label: string; subType: string; awsIcon: AWSServiceIcon; type: SystemNodeType; description?: string },
): DiagramCommand[] {
  const commands: DiagramCommand[] = [];
  const name = sanitizeLabel(edit.label).slice(0, 120);
  if (name !== node.name) commands.push({ type: 'RENAME_NODE', nodeId: node.id, name });

  const kind = typeToKind(edit.type);
  const technology = edit.subType.trim().slice(0, 120);
  const description = (edit.description ?? '').trim().slice(0, 500);
  const metadata: Record<string, unknown> = { ...node.metadata, icon: edit.awsIcon };
  if (description) metadata['description'] = description;
  else delete metadata['description'];

  const updates: { kind?: NodeKind; technology?: string | null; metadata?: Metadata } = {};
  if (kind !== node.kind) updates.kind = kind;
  if (technology !== (node.technology ?? '')) updates.technology = technology || null;
  if (JSON.stringify(metadata) !== JSON.stringify(node.metadata)) updates.metadata = metadata as Metadata;
  if (Object.keys(updates).length > 0) commands.push({ type: 'UPDATE_NODE', nodeId: node.id, updates });
  return commands;
}
