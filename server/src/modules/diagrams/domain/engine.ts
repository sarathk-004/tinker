import {
  GRAPH_SCHEMA_VERSION,
  LIMITS,
  edgeKey,
  findGraphIntegrityIssues,
  findPresentationIntegrityIssues,
  type DiagramCommand,
  type GraphEdge,
  type GraphNode,
  type NewNode,
  type Position,
} from '@tinker/shared';
import { placeNewNodes } from './layout.ts';
import { fail, ok, type DiagramDoc, type DomainResult, type NewId } from './types.ts';

type Cmd<T extends DiagramCommand['type']> = Extract<DiagramCommand, { type: T }>;

/**
 * Apply one validated command to a document. Pure: the input is never mutated, no I/O, no clock, no randomness
 * (ids come from `newId`). On any rule violation the result is an error and the caller still holds the
 * unchanged input, so a failed command can never leave a half-applied diagram.
 *
 * Callers must have schema-validated `command` first (`diagramCommandSchema`); this function enforces
 * domain rules: existing endpoints, no duplicates, no self-loops, unambiguous edges, size limits.
 */
export function applyCommand(doc: DiagramDoc, command: DiagramCommand, newId: NewId): DomainResult<DiagramDoc> {
  const result = dispatch(doc, command, newId);
  if (!result.ok) return result;
  return verifyPostconditions(result.value);
}

function dispatch(doc: DiagramDoc, command: DiagramCommand, newId: NewId): DomainResult<DiagramDoc> {
  switch (command.type) {
    case 'ADD_NODE':
      return addNode(doc, command, newId);
    case 'REMOVE_NODE':
      return removeNode(doc, command);
    case 'RENAME_NODE':
      return renameNode(doc, command);
    case 'UPDATE_NODE':
      return updateNode(doc, command);
    case 'CONNECT':
      return connect(doc, command, newId);
    case 'DISCONNECT':
      return disconnect(doc, command);
    case 'INSERT_BETWEEN':
      return insertBetween(doc, command, newId);
    case 'RESET':
      return reset(doc);
  }
}

const hasNode = (doc: DiagramDoc, id: string) => doc.graph.nodes.some((n) => n.id === id);

function buildNode(spec: NewNode, id: string): GraphNode {
  return {
    id,
    name: spec.name,
    kind: spec.kind,
    ...(spec.technology !== undefined ? { technology: spec.technology } : {}),
    metadata: spec.metadata ?? {},
  };
}

function withGraph(
  doc: DiagramDoc,
  nodes: GraphNode[],
  edges: GraphEdge[],
  newNodeIds: string[] = [],
  hints: Record<string, Position> = {},
): DiagramDoc {
  const graph = { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges } as const;
  const nodePositions = placeNewNodes(graph, doc.presentation.nodePositions, newNodeIds, hints);
  return { graph, presentation: { ...doc.presentation, nodePositions } };
}

function nodeLimit(doc: DiagramDoc, extraNodes: number, extraEdges: number): DomainResult<never> | null {
  if (doc.graph.nodes.length + extraNodes > LIMITS.maxNodes) {
    return fail('LIMIT_EXCEEDED', `A diagram can have at most ${LIMITS.maxNodes} nodes.`, { limit: 'nodes', max: LIMITS.maxNodes });
  }
  if (doc.graph.edges.length + extraEdges > LIMITS.maxEdges) {
    return fail('LIMIT_EXCEEDED', `A diagram can have at most ${LIMITS.maxEdges} edges.`, { limit: 'edges', max: LIMITS.maxEdges });
  }
  return null;
}

function addNode(doc: DiagramDoc, c: Cmd<'ADD_NODE'>, newId: NewId): DomainResult<DiagramDoc> {
  const limited = nodeLimit(doc, 1, 0);
  if (limited) return limited;
  const node = buildNode(c.node, newId());
  return ok(withGraph(doc, [...doc.graph.nodes, node], [...doc.graph.edges], [node.id], c.position ? { [node.id]: c.position } : {}));
}

/** Decision P1: plain removal. The node, every incident edge and its position go; no bridging edges are created. */
function removeNode(doc: DiagramDoc, c: Cmd<'REMOVE_NODE'>): DomainResult<DiagramDoc> {
  if (!hasNode(doc, c.nodeId)) return missingNode(c.nodeId);
  const nodes = doc.graph.nodes.filter((n) => n.id !== c.nodeId);
  const edges = doc.graph.edges.filter((e) => e.sourceNodeId !== c.nodeId && e.targetNodeId !== c.nodeId);
  const { [c.nodeId]: _removed, ...nodePositions } = doc.presentation.nodePositions;
  return ok({ graph: { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges }, presentation: { ...doc.presentation, nodePositions } });
}

function renameNode(doc: DiagramDoc, c: Cmd<'RENAME_NODE'>): DomainResult<DiagramDoc> {
  if (!hasNode(doc, c.nodeId)) return missingNode(c.nodeId);
  const nodes = doc.graph.nodes.map((n) => (n.id === c.nodeId ? { ...n, name: c.name } : n));
  return ok(withGraph(doc, nodes, [...doc.graph.edges]));
}

/** `technology: null` clears the field; provided `metadata` replaces the existing metadata; icons are never re-inferred. */
function updateNode(doc: DiagramDoc, c: Cmd<'UPDATE_NODE'>): DomainResult<DiagramDoc> {
  if (!hasNode(doc, c.nodeId)) return missingNode(c.nodeId);
  const { kind, technology, metadata } = c.updates;
  const nodes = doc.graph.nodes.map((n) => {
    if (n.id !== c.nodeId) return n;
    const { technology: _oldTechnology, ...rest } = n;
    const nextTechnology = technology === undefined ? _oldTechnology : technology === null ? undefined : technology;
    return {
      ...rest,
      ...(kind !== undefined ? { kind } : {}),
      ...(nextTechnology !== undefined ? { technology: nextTechnology } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
  });
  return ok(withGraph(doc, nodes, [...doc.graph.edges]));
}

function connect(doc: DiagramDoc, c: Cmd<'CONNECT'>, newId: NewId): DomainResult<DiagramDoc> {
  if (!hasNode(doc, c.sourceNodeId)) return missingNode(c.sourceNodeId, 'source');
  if (!hasNode(doc, c.targetNodeId)) return missingNode(c.targetNodeId, 'target');
  if (c.sourceNodeId === c.targetNodeId) {
    return fail('SELF_LOOP_UNSUPPORTED', 'A node cannot be connected to itself.', { nodeId: c.sourceNodeId });
  }
  const key = edgeKey(c);
  if (doc.graph.edges.some((e) => edgeKey(e) === key)) {
    return fail('DUPLICATE_EDGE', 'These nodes are already connected with the same relationship.', {
      sourceNodeId: c.sourceNodeId,
      targetNodeId: c.targetNodeId,
    });
  }
  const limited = nodeLimit(doc, 0, 1);
  if (limited) return limited;
  const edge: GraphEdge = {
    id: newId(),
    sourceNodeId: c.sourceNodeId,
    targetNodeId: c.targetNodeId,
    ...(c.relationship !== undefined ? { relationship: c.relationship } : {}),
    metadata: c.metadata ?? {},
  };
  return ok(withGraph(doc, [...doc.graph.nodes], [...doc.graph.edges, edge]));
}

/** Removes exactly one directed edge. (The prototype removed both directions; that now takes two commands.) */
function disconnect(doc: DiagramDoc, c: Cmd<'DISCONNECT'>): DomainResult<DiagramDoc> {
  let target: GraphEdge;
  if (c.edgeId !== undefined) {
    const found = doc.graph.edges.find((e) => e.id === c.edgeId);
    if (!found) return fail('EDGE_NOT_FOUND', 'That connection does not exist.', { edgeId: c.edgeId });
    target = found;
  } else {
    const source = c.sourceNodeId as string;
    const dest = c.targetNodeId as string;
    if (!hasNode(doc, source)) return missingNode(source, 'source');
    if (!hasNode(doc, dest)) return missingNode(dest, 'target');
    const matches = doc.graph.edges.filter((e) => e.sourceNodeId === source && e.targetNodeId === dest);
    if (matches.length === 0) {
      return fail('EDGE_NOT_FOUND', 'These nodes are not connected in that direction.', { sourceNodeId: source, targetNodeId: dest });
    }
    if (matches.length > 1) {
      return fail('AMBIGUOUS_EDGE', 'Several connections exist between these nodes; specify edgeId.', {
        edgeIds: matches.map((e) => e.id),
      });
    }
    target = matches[0] as GraphEdge;
  }
  return ok(withGraph(doc, [...doc.graph.nodes], doc.graph.edges.filter((e) => e.id !== target.id)));
}

/**
 * One atomic operation: remove the original edge, add the node, add source->node and node->target.
 * Both replacement edges copy the original relationship and metadata (decision D06).
 */
function insertBetween(doc: DiagramDoc, c: Cmd<'INSERT_BETWEEN'>, newId: NewId): DomainResult<DiagramDoc> {
  if (!hasNode(doc, c.sourceNodeId)) return missingNode(c.sourceNodeId, 'source');
  if (!hasNode(doc, c.targetNodeId)) return missingNode(c.targetNodeId, 'target');

  const candidates = doc.graph.edges.filter((e) => e.sourceNodeId === c.sourceNodeId && e.targetNodeId === c.targetNodeId);
  let original: GraphEdge;
  if (c.edgeId !== undefined) {
    const chosen = candidates.find((e) => e.id === c.edgeId);
    if (!chosen) {
      return fail('EDGE_NOT_FOUND', 'The given connection does not exist between these nodes.', { edgeId: c.edgeId });
    }
    original = chosen;
  } else if (candidates.length === 0) {
    return fail('EDGE_REQUIRED', 'There is no connection from the source to the target to insert into.', {
      sourceNodeId: c.sourceNodeId,
      targetNodeId: c.targetNodeId,
    });
  } else if (candidates.length > 1) {
    return fail('AMBIGUOUS_EDGE', 'Several connections exist between these nodes; specify edgeId.', {
      edgeIds: candidates.map((e) => e.id),
    });
  } else {
    original = candidates[0] as GraphEdge;
  }

  const limited = nodeLimit(doc, 1, 1);
  if (limited) return limited;

  const node = buildNode(c.node, newId());
  const copy = (sourceNodeId: string, targetNodeId: string): GraphEdge => ({
    id: newId(),
    sourceNodeId,
    targetNodeId,
    ...(original.relationship !== undefined ? { relationship: original.relationship } : {}),
    metadata: { ...original.metadata },
  });
  const edges = [
    ...doc.graph.edges.filter((e) => e.id !== original.id),
    copy(c.sourceNodeId, node.id),
    copy(node.id, c.targetNodeId),
  ];
  // Prefer the middle of the two endpoints; placement then avoids overlaps without moving existing nodes.
  const from = doc.presentation.nodePositions[c.sourceNodeId];
  const to = doc.presentation.nodePositions[c.targetNodeId];
  const hints = from && to ? { [node.id]: { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) } } : {};
  return ok(withGraph(doc, [...doc.graph.nodes, node], edges, [node.id], hints));
}

/** Clears graph and positions; the viewport is kept. Persistence still records this as a new version (D06). */
function reset(doc: DiagramDoc): DomainResult<DiagramDoc> {
  return ok({
    graph: { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [], edges: [] },
    presentation: { ...doc.presentation, nodePositions: {} },
  });
}

function missingNode(nodeId: string, role?: 'source' | 'target') {
  return fail('NODE_NOT_FOUND', role ? `The ${role} node does not exist.` : 'That node does not exist.', { nodeId });
}

/** Defence in depth: an engine bug must surface as a thrown error, never as a corrupt document. */
function verifyPostconditions(doc: DiagramDoc): DomainResult<DiagramDoc> {
  const issues = [...findGraphIntegrityIssues(doc.graph), ...findPresentationIntegrityIssues(doc.graph, doc.presentation)];
  if (issues.length > 0) {
    throw new Error(`Diagram engine produced an invalid document: ${issues.map((i) => i.message).join('; ')}`);
  }
  return ok(doc);
}
