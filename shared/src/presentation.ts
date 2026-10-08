import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { uuidSchema, type IntegrityIssue } from './graph.ts';

export const positionSchema = z.strictObject({ x: z.number(), y: z.number() });

export const viewportSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(LIMITS.zoomMin).max(LIMITS.zoomMax),
});

/** `z.number()` rejects NaN and +/-Infinity, which satisfies D05's finite-coordinate rule. */
export const nodePositionsSchema = z.record(uuidSchema, positionSchema);

/** A free text note placed anywhere on the canvas. It belongs to the view, not to the architecture: it is not a component and has no connections. */
export const noteSchema = z.strictObject({
  id: uuidSchema,
  x: z.number(),
  y: z.number(),
  text: z.string().max(LIMITS.maxNoteChars),
  /** Width in canvas units; the note grows downwards as the text does. */
  width: z.number().min(80).max(800).optional(),
});
export type Note = z.infer<typeof noteSchema>;

export const layoutDirectionSchema = z.enum(['LR', 'TB']);
export type LayoutDirection = z.infer<typeof layoutDirectionSchema>;

export const presentationSchema = z.strictObject({
  nodePositions: nodePositionsSchema,
  viewport: viewportSchema,
  notes: z.array(noteSchema).max(LIMITS.maxNotes).optional(),
  /** Which way the diagram flows now (left to right, or top to bottom). */
  layoutDir: layoutDirectionSchema.optional(),
  /** The arrangement the person had in the OTHER direction, kept so that switching back restores it instead of recomputing it. */
  layouts: z.strictObject({ LR: nodePositionsSchema.optional(), TB: nodePositionsSchema.optional() }).optional(),
});

export type Position = z.infer<typeof positionSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type Presentation = z.infer<typeof presentationSchema>;

export function emptyPresentation(): Presentation {
  return { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } };
}

/** Graph/presentation referential integrity: every position must belong to an existing node. */
export function findPresentationIntegrityIssues(
  graph: { nodes: { id: string }[] },
  presentation: { nodePositions: Record<string, unknown> },
): IntegrityIssue[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  return Object.keys(presentation.nodePositions)
    .filter((id) => !nodeIds.has(id))
    .map((id) => ({
      reason: 'UNKNOWN_POSITION_NODE' as const,
      message: `position for unknown node ${id}`,
      path: ['nodePositions', id],
    }));
}
