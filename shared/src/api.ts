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

export const workspaceRoleSchema = z.enum(['OWNER', 'EDITOR', 'VIEWER']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const workspaceSummarySchema = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  role: workspaceRoleSchema,
  personal: z.boolean(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const meResponseSchema = z.strictObject({
  user: z.strictObject({ id: uuidSchema, email: z.string().nullable(), displayName: z.string().nullable() }),
  workspaces: z.array(workspaceSummarySchema),
  /** What this server can do right now; the UI enables features from this, never from guesses. */
  /**
   * aiCommands: typed commands are offered (the deterministic parser needs no model).
   * aiModel: a model is configured, so free-form requests can be interpreted; without it only plain commands work.
   * voice: spoken requests are possible. speech: the server can synthesize spoken replies (otherwise the browser's own voice is used).
   */
  features: z.strictObject({ aiCommands: z.boolean(), aiModel: z.boolean(), voice: z.boolean(), speech: z.boolean() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const workspacesResponseSchema = z.strictObject({ workspaces: z.array(workspaceSummarySchema) });

/** Newest first; capped (no pagination yet). */
export const diagramListResponseSchema = z.strictObject({ diagrams: z.array(diagramSummarySchema) });
export type DiagramListResponse = z.infer<typeof diagramListResponseSchema>;

/** Full diagram: metadata plus the canonical document. Returned by create, load, rename and presentation saves. */
export const diagramDetailSchema = z
  .strictObject({
    diagramId: uuidSchema,
    workspaceId: uuidSchema,
    name: diagramNameSchema,
    version: versionSchema,
    graph: graphSchema,
    presentation: presentationSchema,
    updatedAt: z.iso.datetime(),
    replayed: z.boolean().optional(),
  })
  .superRefine((doc, ctx) => {
    for (const issue of findPresentationIntegrityIssues(doc.graph, doc.presentation)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['presentation', ...issue.path] });
    }
  });
export type DiagramDetail = z.infer<typeof diagramDetailSchema>;

export const deleteDiagramResponseSchema = z.strictObject({
  diagramId: uuidSchema,
  version: versionSchema,
  deleted: z.literal(true),
  replayed: z.boolean().optional(),
});
export type DeleteDiagramResponse = z.infer<typeof deleteDiagramResponseSchema>;

/** DELETE /v1/diagrams/{id}?expectedVersion=n (deletion participates in the version counter, D05). */
export const expectedVersionQuerySchema = z.strictObject({ expectedVersion: z.coerce.number().int().min(1) });
