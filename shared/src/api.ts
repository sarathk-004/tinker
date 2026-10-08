import { z } from 'zod';
import { aiKeyModeSchema, aiKeySourceSchema } from './ai-key.ts';
import { LIMITS } from './limits.ts';
import { graphSchema, uuidSchema } from './graph.ts';
import {
  findPresentationIntegrityIssues,
  layoutDirectionSchema,
  nodePositionsSchema,
  noteSchema,
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
    /** Replaces ALL notes (the list is small and edited as a whole). */
    notes: z.array(noteSchema).max(LIMITS.maxNotes).optional(),
    layoutDir: layoutDirectionSchema.optional(),
    /** Replaces the remembered arrangements. */
    layouts: presentationSchema.shape.layouts,
  })
  .refine((p) => p.nodePositions !== undefined || p.viewport !== undefined || p.notes !== undefined || p.layoutDir !== undefined || p.layouts !== undefined, {
    message: 'provide nodePositions, viewport, notes, layoutDir or layouts',
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

/** POST /v1/workspaces: start a team workspace (the caller becomes its owner). */
export const createWorkspaceRequestSchema = z.strictObject({ name: z.string().trim().min(1).max(LIMITS.maxWorkspaceNameLength) });
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

const usageSchema = z.strictObject({ used: z.number().int().min(0), limit: z.number().int().min(0) });
/** The day's AI allowance (resets at `resetsAt`, midnight UTC). `ai` counts every request that needs the model; `voice` counts voice sessions. */
export const quotaSchema = z.strictObject({ resetsAt: z.iso.datetime(), ai: usageSchema, voice: usageSchema });
export type Quota = z.infer<typeof quotaSchema>;

/** PUT /v1/me/avatar: a small picture, base64 in JSON. The server checks the real bytes (PNG, JPEG or WebP, at most 256 KB and 1024 px a side). */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const putAvatarRequestSchema = z.strictObject({ contentType: z.enum(AVATAR_TYPES), data: z.string().min(8).max(360_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'not base64') });
export type PutAvatarRequest = z.infer<typeof putAvatarRequestSchema>;
export const avatarResponseSchema = z.strictObject({ contentType: z.enum(AVATAR_TYPES), data: z.string(), updatedAt: z.iso.datetime() });
export type AvatarResponse = z.infer<typeof avatarResponseSchema>;
export const deleteAvatarResponseSchema = z.strictObject({ deleted: z.literal(true) });

export const meResponseSchema = z.strictObject({
  user: z.strictObject({ id: uuidSchema, email: z.string().nullable(), displayName: z.string().nullable(), avatarUpdatedAt: z.iso.datetime().nullable() }),
  workspaces: z.array(workspaceSummarySchema),
  /** What this server can do right now; the UI enables features from this, never from guesses. */
  /**
   * aiCommands: typed commands are offered (the deterministic parser needs no model).
   * aiModel: a model is configured, so free-form requests can be interpreted; without it only plain commands work.
   * aiKey: whose model key this person's AI runs on (see ai-key.ts). voice: spoken requests are possible. speech: the server can synthesize spoken replies (otherwise the browser's own voice is used).
   */
  features: z.strictObject({ aiCommands: z.boolean(), aiModel: z.boolean(), voice: z.boolean(), speech: z.boolean(), aiKey: z.strictObject({ mode: aiKeyModeSchema, source: aiKeySourceSchema }) }),
  quota: quotaSchema,
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
