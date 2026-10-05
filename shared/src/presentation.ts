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

export const presentationSchema = z.strictObject({
  nodePositions: nodePositionsSchema,
  viewport: viewportSchema,
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
