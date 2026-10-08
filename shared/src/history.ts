import { z } from 'zod';
import { diagramDetailSchema } from './api.ts';
import { versionSchema } from './commands.ts';
import { graphSchema, uuidSchema } from './graph.ts';
import { presentationSchema } from './presentation.ts';

/** Why a revision exists (diagram_revisions.reason). */
export const REVISION_REASONS = ['AI_COMMAND', 'MANUAL_COMMAND', 'AUTOSAVE', 'CHECKPOINT', 'RESTORE'] as const;
export const revisionReasonSchema = z.enum(REVISION_REASONS);

/**
 * What the history keeps (decision D11, tiered): every one of the latest `keepLatest` versions (this is what undo walks), then one
 * per hour for `hourlyDays` days, then one per day until `keepDays` days. A diagram never holds more than a few hundred versions.
 */
export const REVISION_RETENTION = { keepLatest: 100, hourlyDays: 7, keepDays: 90 } as const;

export const revisionSummarySchema = z.strictObject({
  version: versionSchema,
  reason: revisionReasonSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.strictObject({ id: uuidSchema, name: z.string().nullable() }),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
});
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;

/** GET /v1/diagrams/{id}/revisions?before=<version>&limit=<n>: newest first. `nextBefore` continues the listing. */
export const revisionListResponseSchema = z.strictObject({
  revisions: z.array(revisionSummarySchema),
  nextBefore: versionSchema.nullable(),
  retention: z.strictObject({ keepLatest: z.number().int(), hourlyDays: z.number().int(), keepDays: z.number().int() }),
});
export type RevisionListResponse = z.infer<typeof revisionListResponseSchema>;

export const revisionListQuerySchema = z.strictObject({
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /v1/diagrams/{id}/revisions/{version}: one revision with its document (for previewing before restoring). */
export const revisionDetailSchema = revisionSummarySchema.extend({ graph: graphSchema, presentation: presentationSchema });
export type RevisionDetail = z.infer<typeof revisionDetailSchema>;

/**
 * POST /v1/diagrams/{id}/restore: make the diagram look like revision `version`, as a NEW version (the version number never goes
 * back). Needs the usual Idempotency-Key and the version the caller sees.
 */
export const restoreRequestSchema = z.strictObject({ expectedVersion: versionSchema, version: versionSchema });
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

/** The new head of the diagram (same shape as rename and presentation saves). */
export const restoreResponseSchema = diagramDetailSchema;
export type RestoreResponse = z.infer<typeof restoreResponseSchema>;
