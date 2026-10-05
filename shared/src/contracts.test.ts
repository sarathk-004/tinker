import { describe, expect, it } from 'vitest';
import {
  COMMAND_TYPES,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_RETRY_POLICY,
  GRAPH_SCHEMA_VERSION,
  LIMITS,
  NODE_KINDS,
  NODE_KIND_FROM_LEGACY,
  commandRequestSchema,
  commandResponseSchema,
  diagramCommandSchema,
  diagramDocumentSchema,
  emptyGraph,
  emptyPresentation,
  errorEnvelopeSchema,
  graphSchema,
  idempotencyKeySchema,
  presentationPatchRequestSchema,
  presentationSchema,
} from './index.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const E2 = '44444444-4444-4444-8444-444444444444';

const node = (id: string, name = 'Orders') => ({ id, name, kind: 'SERVICE' as const, metadata: {} });
const edge = (id: string, s: string, t: string, relationship?: string) => ({
  id,
  sourceNodeId: s,
  targetNodeId: t,
  ...(relationship ? { relationship } : {}),
  metadata: {},
});
const graph = (nodes: unknown[], edges: unknown[]) => ({ schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges });

describe('graph schema', () => {
  it('accepts an empty graph and a valid graph', () => {
    expect(graphSchema.safeParse(emptyGraph()).success).toBe(true);
    expect(graphSchema.safeParse(graph([node(A), node(B, 'DB')], [edge(E1, A, B, 'HTTP')])).success).toBe(true);
  });

  it('rejects non-UUID ids, unknown kinds, blank names and extra fields', () => {
    expect(graphSchema.safeParse(graph([node('orders')], [])).success).toBe(false);
    expect(graphSchema.safeParse(graph([{ ...node(A), kind: 'service' }], [])).success).toBe(false);
    expect(graphSchema.safeParse(graph([node(A, '   ')], [])).success).toBe(false);
    expect(graphSchema.safeParse(graph([{ ...node(A), position: { x: 1, y: 2 } }], [])).success).toBe(false);
  });

  it('enforces referential integrity', () => {
    const dupNode = graphSchema.safeParse(graph([node(A), node(A)], []));
    const dangling = graphSchema.safeParse(graph([node(A)], [edge(E1, A, B)]));
    const selfLoop = graphSchema.safeParse(graph([node(A)], [edge(E1, A, A)]));
    const dupEdge = graphSchema.safeParse(graph([node(A), node(B)], [edge(E1, A, B, 'HTTP'), edge(E2, A, B, 'HTTP')]));
    expect([dupNode.success, dangling.success, selfLoop.success, dupEdge.success]).toEqual([false, false, false, false]);
  });

  it('allows parallel edges that differ by relationship', () => {
    const ok = graphSchema.safeParse(graph([node(A), node(B)], [edge(E1, A, B, 'HTTP'), edge(E2, A, B, 'events')]));
    expect(ok.success).toBe(true);
  });

  it('enforces node and edge limits and bounded metadata', () => {
    const many = Array.from({ length: LIMITS.maxNodes + 1 }, (_, i) =>
      node(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    );
    expect(graphSchema.safeParse(graph(many, [])).success).toBe(false);
    const big = { ...node(A), metadata: { blob: 'x'.repeat(LIMITS.maxMetadataChars) } };
    expect(graphSchema.safeParse(graph([big], [])).success).toBe(false);
  });
});

describe('presentation schema', () => {
  it('accepts positions and viewport', () => {
    expect(presentationSchema.safeParse({ nodePositions: { [A]: { x: 1.5, y: -2 } }, viewport: { x: 0, y: 0, zoom: 1 } }).success).toBe(true);
    expect(presentationSchema.safeParse(emptyPresentation()).success).toBe(true);
  });

  it('rejects non-finite coordinates, bad zoom and non-UUID keys', () => {
    const base = { viewport: { x: 0, y: 0, zoom: 1 } };
    expect(presentationSchema.safeParse({ ...base, nodePositions: { [A]: { x: Number.NaN, y: 0 } } }).success).toBe(false);
    expect(presentationSchema.safeParse({ ...base, nodePositions: { [A]: { x: Infinity, y: 0 } } }).success).toBe(false);
    expect(presentationSchema.safeParse({ nodePositions: {}, viewport: { x: 0, y: 0, zoom: 0 } }).success).toBe(false);
    expect(presentationSchema.safeParse({ ...base, nodePositions: { orders: { x: 0, y: 0 } } }).success).toBe(false);
  });

  it('document validation rejects positions for unknown nodes', () => {
    const doc = {
      diagramId: A,
      version: 1,
      graph: graph([node(B)], []),
      presentation: { nodePositions: { [A]: { x: 0, y: 0 } }, viewport: { x: 0, y: 0, zoom: 1 } },
    };
    expect(diagramDocumentSchema.safeParse(doc).success).toBe(false);
    expect(diagramDocumentSchema.safeParse({ ...doc, presentation: emptyPresentation() }).success).toBe(true);
  });

  it('patch requires at least one field and a version', () => {
    expect(presentationPatchRequestSchema.safeParse({ expectedVersion: 2 }).success).toBe(false);
    expect(presentationPatchRequestSchema.safeParse({ expectedVersion: 2, nodePositions: { [A]: { x: 1, y: 2 } } }).success).toBe(true);
    expect(presentationPatchRequestSchema.safeParse({ nodePositions: { [A]: { x: 1, y: 2 } } }).success).toBe(false);
  });
});

describe('command union', () => {
  const valid: unknown[] = [
    { type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE' } },
    { type: 'REMOVE_NODE', nodeId: A },
    { type: 'RENAME_NODE', nodeId: A, name: 'Billing' },
    { type: 'UPDATE_NODE', nodeId: A, updates: { technology: null } },
    { type: 'CONNECT', sourceNodeId: A, targetNodeId: B, relationship: 'HTTP' },
    { type: 'DISCONNECT', edgeId: E1 },
    { type: 'DISCONNECT', sourceNodeId: A, targetNodeId: B },
    { type: 'INSERT_BETWEEN', sourceNodeId: A, targetNodeId: B, node: { name: 'Redis', kind: 'CACHE', technology: 'Redis' } },
    { type: 'RESET' },
  ];

  it('accepts every command type', () => {
    for (const command of valid) expect(diagramCommandSchema.safeParse(command).success).toBe(true);
    const seen = new Set(valid.map((c) => (c as { type: string }).type));
    expect([...seen].sort()).toEqual([...COMMAND_TYPES].sort());
  });

  it('rejects malformed commands', () => {
    const invalid: unknown[] = [
      { type: 'DROP_TABLE' },
      { type: 'ADD_NODE', node: { name: 'Orders', kind: 'service' } },
      { type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE', id: A } },
      { type: 'REMOVE_NODE', nodeId: 'orders' },
      { type: 'REMOVE_NODE', nodeId: A, reconnect: true },
      { type: 'UPDATE_NODE', nodeId: A, updates: {} },
      { type: 'UPDATE_NODE', nodeId: A, updates: { name: 'x' } },
      { type: 'DISCONNECT' },
      { type: 'DISCONNECT', edgeId: E1, sourceNodeId: A, targetNodeId: B },
      { type: 'DISCONNECT', sourceNodeId: A },
      { type: 'INSERT_BETWEEN', sourceNodeId: A, targetNodeId: B },
      { type: 'RESET', extra: 1 },
      null,
      'ADD_NODE',
    ];
    for (const command of invalid) expect(diagramCommandSchema.safeParse(command).success, JSON.stringify(command)).toBe(false);
  });

  it('request envelope needs a positive integer expectedVersion', () => {
    const command = { type: 'RESET' };
    expect(commandRequestSchema.safeParse({ expectedVersion: 14, command }).success).toBe(true);
    for (const expectedVersion of [0, -1, 1.5, '14', undefined]) {
      expect(commandRequestSchema.safeParse({ expectedVersion, command }).success).toBe(false);
    }
  });

  it('validates the Idempotency-Key header', () => {
    expect(idempotencyKeySchema.safeParse('6f1d2c3a-8b7e-4f10-9a11-0123456789ab').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has space in key').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('x'.repeat(LIMITS.maxIdempotencyKeyLength + 1)).success).toBe(false);
  });
});

describe('responses and errors', () => {
  it('command response carries the full canonical document', () => {
    const response = {
      diagramId: A,
      version: 15,
      appliedCommand: { type: 'ADD_NODE' },
      graph: graph([node(B)], []),
      presentation: emptyPresentation(),
    };
    expect(commandResponseSchema.safeParse(response).success).toBe(true);
    expect(commandResponseSchema.safeParse({ ...response, appliedCommand: { type: 'NOPE' } }).success).toBe(false);
  });

  it('every error code has a status and a retry policy; envelope validates', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_RETRY_POLICY[code]).toBeDefined();
    }
    expect(Object.keys(ERROR_RETRY_POLICY).sort()).toEqual([...ERROR_CODES].sort());
    const envelope = {
      error: { code: 'DIAGRAM_VERSION_CONFLICT', message: 'x', requestId: 'r', details: { expectedVersion: 14, currentVersion: 15 } },
    };
    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ error: { ...envelope.error, code: 'WHATEVER' } }).success).toBe(false);
  });

  it('LLD status mapping is preserved', () => {
    expect(ERROR_HTTP_STATUS).toMatchObject({
      INVALID_REQUEST: 400, INVALID_COMMAND: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, DIAGRAM_NOT_FOUND: 404,
      DIAGRAM_VERSION_CONFLICT: 409, IDEMPOTENCY_KEY_REUSED: 409, REQUEST_ALREADY_PROCESSING: 409,
      DOMAIN_VALIDATION_FAILED: 422, RATE_LIMITED: 429, AI_PROVIDER_ERROR: 502, AI_UNAVAILABLE: 503, AI_TIMEOUT: 504,
    });
  });

  it('maps every prototype node type to a NodeKind', () => {
    expect(Object.values(NODE_KIND_FROM_LEGACY).sort()).toEqual([...NODE_KINDS].sort());
  });
});
