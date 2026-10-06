import { graphSchema, presentationSchema, type Graph, type Presentation, type RevisionSummary } from '@tinker/shared';
import type { Queryable } from '../../../infrastructure/database/pool.ts';

interface SummaryRow {
  version: string | number;
  reason: RevisionSummary['reason'];
  created_at: Date;
  created_by: string;
  display_name: string | null;
  node_count: number;
  edge_count: number;
}

const toSummary = (r: SummaryRow): RevisionSummary => ({
  version: Number(r.version),
  reason: r.reason,
  createdAt: r.created_at.toISOString(),
  createdBy: { id: r.created_by, name: r.display_name },
  nodeCount: r.node_count,
  edgeCount: r.edge_count,
});

/** Newest first. Asks for one extra row so the caller can tell whether more exist. */
export async function listRevisionSummaries(db: Queryable, diagramId: string, before: number | undefined, limit: number): Promise<{ revisions: RevisionSummary[]; nextBefore: number | null }> {
  const { rows } = await db.query<SummaryRow>(
    `SELECT r.version, r.reason, r.created_at, r.created_by, u.display_name,
            COALESCE(jsonb_array_length(r.graph->'nodes'), 0)::int AS node_count,
            COALESCE(jsonb_array_length(r.graph->'edges'), 0)::int AS edge_count
       FROM diagram_revisions r JOIN users u ON u.id = r.created_by
      WHERE r.diagram_id = $1 AND ($2::bigint IS NULL OR r.version < $2)
      ORDER BY r.version DESC
      LIMIT $3`,
    [diagramId, before ?? null, limit + 1],
  );
  const page = rows.slice(0, limit).map(toSummary);
  return { revisions: page, nextBefore: rows.length > limit ? page[page.length - 1]!.version : null };
}

export interface RevisionRow extends RevisionSummary {
  graph: Graph;
  presentation: Presentation;
}

/** Stored documents are re-validated on read, like the live diagram. */
export async function getRevision(db: Queryable, diagramId: string, version: number): Promise<RevisionRow | null> {
  const { rows } = await db.query<SummaryRow & { graph: unknown; presentation: unknown }>(
    `SELECT r.version, r.reason, r.created_at, r.created_by, u.display_name, r.graph, r.presentation,
            COALESCE(jsonb_array_length(r.graph->'nodes'), 0)::int AS node_count,
            COALESCE(jsonb_array_length(r.graph->'edges'), 0)::int AS edge_count
       FROM diagram_revisions r JOIN users u ON u.id = r.created_by
      WHERE r.diagram_id = $1 AND r.version = $2`,
    [diagramId, version],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row), graph: graphSchema.parse(row.graph), presentation: presentationSchema.parse(row.presentation) };
}

export async function insertRestoreExecution(
  db: Queryable,
  input: { mutationRequestId: string; diagramId: string; actorId: string; restoredVersion: number; expectedVersion: number; resultVersion: number },
): Promise<void> {
  await db.query(
    `INSERT INTO command_executions
       (mutation_request_id, diagram_id, actor_id, command_type, command_payload, status, expected_version, result_version, completed_at)
     VALUES ($1, $2, $3, 'RESTORE', $4::jsonb, 'SUCCEEDED', $5, $6, now())`,
    [input.mutationRequestId, input.diagramId, input.actorId, JSON.stringify({ restoredVersion: input.restoredVersion }), input.expectedVersion, input.resultVersion],
  );
}
