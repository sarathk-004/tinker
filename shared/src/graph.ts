import { z } from 'zod';
import { GRAPH_SCHEMA_VERSION, LIMITS } from './limits.ts';
import { nodeKindSchema } from './node-kind.ts';

export const uuidSchema = z.uuid();

export const nodeNameSchema = z.string().trim().min(1).max(LIMITS.maxNodeNameLength);
export const technologySchema = z.string().trim().min(1).max(LIMITS.maxTechnologyLength);
export const relationshipSchema = z.string().trim().min(1).max(LIMITS.maxRelationshipLength);

/**
 * Free-form, JSON-only, bounded. Conventions (not interpreted by the engine):
 * node: `icon`, `description`, `group`; edge: `bidirectional` (decision D06).
 */
export const metadataSchema = z
  .record(z.string().min(1).max(LIMITS.maxMetadataKeyLength), z.json())
  .refine((value) => JSON.stringify(value).length <= LIMITS.maxMetadataChars, {
    message: `metadata exceeds ${LIMITS.maxMetadataChars} characters`,
  });

export const graphNodeSchema = z.strictObject({
  id: uuidSchema,
  name: nodeNameSchema,
  kind: nodeKindSchema,
  technology: technologySchema.optional(),
  metadata: metadataSchema,
});

export const graphEdgeSchema = z.strictObject({
  id: uuidSchema,
  sourceNodeId: uuidSchema,
  targetNodeId: uuidSchema,
  relationship: relationshipSchema.optional(),
  metadata: metadataSchema,
});

export interface IntegrityIssue {
  reason:
    | 'DUPLICATE_NODE_ID'
    | 'DUPLICATE_EDGE_ID'
    | 'NODE_NOT_FOUND'
    | 'SELF_LOOP_UNSUPPORTED'
    | 'DUPLICATE_EDGE'
    | 'UNKNOWN_POSITION_NODE';
  message: string;
  path: (string | number)[];
}

type NodeLike = { id: string };
type EdgeLike = { id: string; sourceNodeId: string; targetNodeId: string; relationship?: string | undefined };

/** Identity of an edge for duplicate detection: same endpoints and same relationship. */
export function edgeKey(edge: Pick<EdgeLike, 'sourceNodeId' | 'targetNodeId' | 'relationship'>): string {
  return `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.relationship ?? ''}`;
}

export function findGraphIntegrityIssues(graph: { nodes: NodeLike[]; edges: EdgeLike[] }): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const nodeIds = new Set<string>();
  graph.nodes.forEach((node, i) => {
    if (nodeIds.has(node.id)) {
      issues.push({ reason: 'DUPLICATE_NODE_ID', message: `duplicate node id ${node.id}`, path: ['nodes', i, 'id'] });
    }
    nodeIds.add(node.id);
  });
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  graph.edges.forEach((edge, i) => {
    if (edgeIds.has(edge.id)) {
      issues.push({ reason: 'DUPLICATE_EDGE_ID', message: `duplicate edge id ${edge.id}`, path: ['edges', i, 'id'] });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.sourceNodeId)) {
      issues.push({ reason: 'NODE_NOT_FOUND', message: 'edge source node does not exist', path: ['edges', i, 'sourceNodeId'] });
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      issues.push({ reason: 'NODE_NOT_FOUND', message: 'edge target node does not exist', path: ['edges', i, 'targetNodeId'] });
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      issues.push({ reason: 'SELF_LOOP_UNSUPPORTED', message: 'self-loop edges are not supported', path: ['edges', i] });
    }
    const key = edgeKey(edge);
    if (edgeKeys.has(key)) {
      issues.push({ reason: 'DUPLICATE_EDGE', message: 'duplicate edge', path: ['edges', i] });
    }
    edgeKeys.add(key);
  });
  return issues;
}

/** Shape + referential integrity (unique ids, known endpoints, no self-loops, no duplicate edges, limits). */
export const graphSchema = z
  .strictObject({
    schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
    nodes: z.array(graphNodeSchema).max(LIMITS.maxNodes),
    edges: z.array(graphEdgeSchema).max(LIMITS.maxEdges),
  })
  .superRefine((graph, ctx) => {
    for (const issue of findGraphIntegrityIssues(graph)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type Graph = z.infer<typeof graphSchema>;

export function emptyGraph(): Graph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [], edges: [] };
}
