import {
  emptyGraph,
  emptyPresentation,
  graphSchema,
  presentationSchema,
  type DiagramCommand,
  type DiagramSummary,
  type Graph,
  type Presentation,
} from '@tinker/shared';
import type { Queryable } from '../../../infrastructure/database/pool.ts';

export interface DiagramRow {
  id: string;
  workspaceId: string;
  name: string;
  graph: Graph;
  presentation: Presentation;
  version: number;
  updatedAt: Date;
}

interface RawRow {
  id: string;
  workspace_id: string;
  name: string;
  graph: unknown;
  presentation: unknown;
  version: number;
  updated_at: Date;
}

/** Stored documents are re-validated on read: a corrupted row must fail loudly, never reach a client or the engine. */
function toRow(raw: RawRow): DiagramRow {
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    name: raw.name,
    graph: graphSchema.parse(raw.graph),
    presentation: presentationSchema.parse(raw.presentation),
    version: raw.version,
    updatedAt: raw.updated_at,
  };
}

const COLUMNS = 'id, workspace_id, name, graph, presentation, version, updated_at';

export async function insertDiagram(db: Queryable, input: { workspaceId: string; name: string; createdBy: string }): Promise<DiagramRow> {
  const { rows } = await db.query<RawRow>(
    `INSERT INTO diagrams (workspace_id, name, graph, presentation, created_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     RETURNING ${COLUMNS}`,
    [input.workspaceId, input.name, JSON.stringify(emptyGraph()), JSON.stringify(emptyPresentation()), input.createdBy],
  );
  return toRow(rows[0]!);
}

export async function getDiagramRow(db: Queryable, id: string): Promise<DiagramRow | null> {
  const { rows } = await db.query<RawRow>(`SELECT ${COLUMNS} FROM diagrams WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Row lock: concurrent writers to one diagram queue here, then the loser sees the new version and conflicts. */
export async function lockDiagramRow(db: Queryable, id: string): Promise<DiagramRow | null> {
  const { rows } = await db.query<RawRow>(`SELECT ${COLUMNS} FROM diagrams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listDiagramSummaries(db: Queryable, workspaceId: string, limit = 200): Promise<DiagramSummary[]> {
  const { rows } = await db.query<{ id: string; workspace_id: string; name: string; version: number; created_at: Date; updated_at: Date }>(
    `SELECT id, workspace_id, name, version, created_at, updated_at
       FROM diagrams WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY updated_at DESC, id LIMIT $2`,
    [workspaceId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

/**
 * The authoritative conditional write (LLD section 5): zero rows means the version moved or the diagram vanished.
 * Returns the new row, or null.
 */
export async function updateDocument(
  db: Queryable,
  input: { id: string; expectedVersion: number; graph?: Graph; presentation?: Presentation; name?: string; deleted?: boolean },
): Promise<DiagramRow | null> {
  const { rows } = await db.query<RawRow>(
    `UPDATE diagrams
        SET graph = COALESCE($3::jsonb, graph),
            presentation = COALESCE($4::jsonb, presentation),
            name = COALESCE($5, name),
            deleted_at = CASE WHEN $6::boolean THEN now() ELSE deleted_at END,
            version = version + 1,
            updated_at = now()
      WHERE id = $1 AND version = $2 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    [
      input.id,
      input.expectedVersion,
      input.graph ? JSON.stringify(input.graph) : null,
      input.presentation ? JSON.stringify(input.presentation) : null,
      input.name ?? null,
      input.deleted ?? false,
    ],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function insertRevision(
  db: Queryable,
  input: { diagramId: string; version: number; graph: Graph; presentation: Presentation; reason: string; createdBy: string },
): Promise<void> {
  await db.query(
    `INSERT INTO diagram_revisions (diagram_id, version, graph, presentation, reason, created_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
    [input.diagramId, input.version, JSON.stringify(input.graph), JSON.stringify(input.presentation), input.reason, input.createdBy],
  );
}

export async function insertCommandExecution(
  db: Queryable,
  input: {
    mutationRequestId: string;
    diagramId: string;
    actorId: string;
    command: DiagramCommand;
    status: 'SUCCEEDED' | 'FAILED';
    errorCode?: string;
    expectedVersion: number;
    resultVersion?: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO command_executions
       (mutation_request_id, diagram_id, actor_id, command_type, command_payload, status, error_code, expected_version, result_version, completed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, now())`,
    [
      input.mutationRequestId,
      input.diagramId,
      input.actorId,
      input.command.type,
      JSON.stringify(input.command),
      input.status,
      input.errorCode ?? null,
      input.expectedVersion,
      input.resultVersion ?? null,
    ],
  );
}

export async function attachDiagramToRequest(db: Queryable, mutationRequestId: string, diagramId: string): Promise<void> {
  await db.query(`UPDATE mutation_requests SET diagram_id = $2 WHERE id = $1`, [mutationRequestId, diagramId]);
}

/** One execution record per AI/parser plan (all of its steps committed together as a single version). */
export async function insertPlanExecution(
  db: Queryable,
  input: { mutationRequestId: string; diagramId: string; actorId: string; source: 'PARSER' | 'AI'; commands: DiagramCommand[]; expectedVersion: number; resultVersion: number },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO command_executions
       (mutation_request_id, diagram_id, actor_id, command_type, command_payload, status, expected_version, result_version, completed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'SUCCEEDED', $6, $7, now())
     RETURNING id`,
    [input.mutationRequestId, input.diagramId, input.actorId, `${input.source}_PLAN`, JSON.stringify({ source: input.source, commands: input.commands }), input.expectedVersion, input.resultVersion],
  );
  return rows[0]!.id;
}
