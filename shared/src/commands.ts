import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { metadataSchema, nodeNameSchema, relationshipSchema, technologySchema, uuidSchema } from './graph.ts';
import { nodeKindSchema } from './node-kind.ts';
import { positionSchema } from './presentation.ts';
import { groupPathSchema } from './groups.ts';

/** Fields a client may supply for a new node. The server assigns the UUID (D04). */
export const newNodeSchema = z.strictObject({
  name: nodeNameSchema,
  kind: nodeKindSchema,
  technology: technologySchema.optional(),
  metadata: metadataSchema.optional(),
});

export const addNodeCommandSchema = z.strictObject({
  type: z.literal('ADD_NODE'),
  node: newNodeSchema,
  /** Where the person wants it (a drop point, the middle of the screen). The server keeps it unless another component is already there. */
  position: positionSchema.optional(),
});

/** Plain removal: node, incident edges and presentation entry (decision P1). No bridging. */
export const removeNodeCommandSchema = z.strictObject({
  type: z.literal('REMOVE_NODE'),
  nodeId: uuidSchema,
});

export const renameNodeCommandSchema = z.strictObject({
  type: z.literal('RENAME_NODE'),
  nodeId: uuidSchema,
  name: nodeNameSchema,
});

/** Name changes use RENAME_NODE. `technology: null` clears the field. Provided metadata replaces existing metadata. */
export const updateNodeCommandSchema = z.strictObject({
  type: z.literal('UPDATE_NODE'),
  nodeId: uuidSchema,
  updates: z
    .strictObject({
      kind: nodeKindSchema.optional(),
      technology: technologySchema.nullable().optional(),
      metadata: metadataSchema.optional(),
    })
    .refine((u) => Object.keys(u).length > 0, { message: 'updates must change at least one field' }),
});

export const connectNodesCommandSchema = z.strictObject({
  type: z.literal('CONNECT'),
  sourceNodeId: uuidSchema,
  targetNodeId: uuidSchema,
  relationship: relationshipSchema.optional(),
  metadata: metadataSchema.optional(),
});

/** Identify the edge by `edgeId`, or by source+target (domain validation rejects ambiguity with parallel edges). */
export const disconnectNodesCommandSchema = z
  .strictObject({
    type: z.literal('DISCONNECT'),
    edgeId: uuidSchema.optional(),
    sourceNodeId: uuidSchema.optional(),
    targetNodeId: uuidSchema.optional(),
  })
  .refine(
    (c) => {
      const hasEdge = c.edgeId !== undefined;
      const hasSource = c.sourceNodeId !== undefined;
      const hasTarget = c.targetNodeId !== undefined;
      return hasEdge ? !hasSource && !hasTarget : hasSource && hasTarget;
    },
    { message: 'provide either edgeId or both sourceNodeId and targetNodeId' },
  );

/** `edgeId` is required by domain validation whenever parallel source->target edges exist (D06). */
export const insertBetweenCommandSchema = z.strictObject({
  type: z.literal('INSERT_BETWEEN'),
  sourceNodeId: uuidSchema,
  targetNodeId: uuidSchema,
  edgeId: uuidSchema.optional(),
  node: newNodeSchema,
});

export const resetDiagramCommandSchema = z.strictObject({
  type: z.literal('RESET'),
});

/** Put components into a group (a path, see groups.ts), or take them out of any group with `group: null`. One command, one version. */
export const setGroupCommandSchema = z.strictObject({
  type: z.literal('SET_GROUP'),
  nodeIds: z.array(uuidSchema).min(1).max(LIMITS.maxNodes),
  group: groupPathSchema.nullable(),
});

/** Rename a group and everything inside it (this is also how a group is moved inside another one: its new path starts with the parent). */
export const renameGroupCommandSchema = z.strictObject({
  type: z.literal('RENAME_GROUP'),
  from: groupPathSchema,
  to: groupPathSchema,
});

export const diagramCommandSchema = z.discriminatedUnion('type', [
  addNodeCommandSchema,
  removeNodeCommandSchema,
  renameNodeCommandSchema,
  updateNodeCommandSchema,
  connectNodesCommandSchema,
  disconnectNodesCommandSchema,
  insertBetweenCommandSchema,
  setGroupCommandSchema,
  renameGroupCommandSchema,
  resetDiagramCommandSchema,
]);

export const COMMAND_TYPES = [
  'ADD_NODE',
  'REMOVE_NODE',
  'RENAME_NODE',
  'UPDATE_NODE',
  'CONNECT',
  'DISCONNECT',
  'INSERT_BETWEEN',
  'SET_GROUP',
  'RENAME_GROUP',
  'RESET',
] as const;

export type DiagramCommand = z.infer<typeof diagramCommandSchema>;
export type DiagramCommandType = DiagramCommand['type'];
export type NewNode = z.infer<typeof newNodeSchema>;

export const versionSchema = z.number().int().min(1);

/** Body of POST /v1/diagrams/{id}/commands. */
export const commandRequestSchema = z.strictObject({
  expectedVersion: versionSchema,
  command: diagramCommandSchema,
});
export type CommandRequest = z.infer<typeof commandRequestSchema>;

/** Idempotency-Key header (D01): opaque, printable ASCII without spaces. */
export const idempotencyKeySchema = z
  .string()
  .min(LIMITS.minIdempotencyKeyLength)
  .max(LIMITS.maxIdempotencyKeyLength)
  .regex(/^[\x21-\x7e]+$/, 'must be printable ASCII without spaces');
