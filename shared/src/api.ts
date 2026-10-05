import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { graphSchema, uuidSchema } from './graph.ts';
import {
  findPresentationIntegrityIssues,
  nodePositionsSchema,
  presentationSchema,
  viewportSchema,
} from './presentation.ts';
import { COMMAND_TYPES, versionSchema } from './commands.ts';

export const diagramNameSchema = z.string().trim().min(1).max(LIMITS.maxDiagramNameLength);

/** Complete canonical document returned by durable mutations (D05). */
export const diagramDocumentSchema = z
  .strictObject({
    diagramId: uuidSchema,
    version: versionSchema,
    graph: graphSchema,
    presentation: presentationSchema,
  })
  .superRefine((doc, ctx) => {
    for (const issue of findPresentationIntegrityIssues(doc.graph, doc.presentation)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['presentation', ...issue.path] });
    }
  });
export type DiagramDocument = z.infer<typeof diagramDocumentSchema>;

export const diagramSummarySchema = z.strictObject({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: diagramNameSchema,
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DiagramSummary = z.infer<typeof diagramSummarySchema>;

export const createDiagramRequestSchema = z.strictObject({ name: diagramNameSchema });
export const renameDiagramRequestSchema = z.strictObject({ expectedVersion: versionSchema, name: diagramNameSchema });

/** PATCH /v1/diagrams/{id}/presentation: provided positions merge by node id; absent entries are unchanged. */
export const presentationPatchRequestSchema = z
  .strictObject({
    expectedVersion: versionSchema,
    nodePositions: nodePositionsSchema.optional(),
    viewport: viewportSchema.optional(),
  })
  .refine((p) => p.nodePositions !== undefined || p.viewport !== undefined, {
    message: 'provide nodePositions or viewport',
  });
export type PresentationPatchRequest = z.infer<typeof presentationPatchRequestSchema>;

export const commandResponseSchema = z.strictObject({
  diagramId: uuidSchema,
  version: versionSchema,
  appliedCommand: z.strictObject({ type: z.enum(COMMAND_TYPES) }),
  graph: graphSchema,
  presentation: presentationSchema,
  /** True when this is a stored replay of an earlier identical request (D01). */
  replayed: z.boolean().optional(),
});
export type CommandResponse = z.infer<typeof commandResponseSchema>;

export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('tinker-api'),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
