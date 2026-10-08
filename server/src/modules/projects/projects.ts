import { LIMITS, graphSchema, presentationSchema, type DiagramCard, type Graph, type Overview, type Presentation, type ProjectCover, type ProjectSummary } from '@tinker/shared';
import { withTransaction, type Pool, type Queryable } from '../../infrastructure/database/pool.ts';
import { AppError } from '../../infrastructure/http/errors.ts';
import { authorizeWorkspace, can, workspaceRole } from '../workspaces/access.ts';

/**
 * Workspace -> project -> diagram. A project groups related diagrams. Every workspace always has at least one (the first is "General"),
 * so a diagram always has a place to live. Reading follows the workspace's rules; changing needs editor or owner; deleting a project
 * is the owner's, and takes its diagrams with it (soft-deleted, so the usual recovery window applies).
 */

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  cover: ProjectCover | null;
  diagram_count: number;
  updated_at: Date;
  latest_id: string | null;
  latest_name: string | null;
  latest_graph: unknown;
  latest_presentation: unknown;
}

const toSummary = (r: ProjectRow): ProjectSummary => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  description: r.description,
  cover: r.cover,
  diagramCount: r.diagram_count,
  updatedAt: r.updated_at.toISOString(),
  latestDiagram: r.latest_id ? { id: r.latest_id, name: r.latest_name ?? '', preview: previewOf(graphSchema.parse(r.latest_graph), presentationSchema.parse(r.latest_presentation)) } : null,
});

const SELECT = `
  p.id, p.workspace_id, p.name, p.description, p.cover, l.id AS latest_id, l.name AS latest_name, l.graph AS latest_graph, l.presentation AS latest_presentation,
  (SELECT count(*)::int FROM diagrams d WHERE d.project_id = p.id AND d.deleted_at IS NULL) AS diagram_count,
  GREATEST(p.updated_at, COALESCE((SELECT max(d.updated_at) FROM diagrams d WHERE d.project_id = p.id AND d.deleted_at IS NULL), p.updated_at)) AS updated_at`;

/** Every project with the diagram it was last worked on (for the card's cover and for opening the project straight into it). */
const FROM_PROJECTS = `FROM projects p LEFT JOIN LATERAL (
  SELECT d.id, d.name, d.graph, d.presentation FROM diagrams d WHERE d.project_id = p.id AND d.deleted_at IS NULL ORDER BY d.updated_at DESC, d.id LIMIT 1
) l ON true`;

/** The workspace's first project; made on the spot when a workspace somehow has none (older data, or a first read after a restore). */
export async function ensureDefaultProject(db: Queryable, workspaceId: string, userId: string): Promise<string> {
  const found = await db.query<{ id: string }>(`SELECT id FROM projects WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`, [workspaceId]);
  if (found.rows[0]) return found.rows[0].id;
  const made = await db.query<{ id: string }>(`INSERT INTO projects (workspace_id, name, created_by) VALUES ($1, 'General', $2) RETURNING id`, [workspaceId, userId]);
  return made.rows[0]!.id;
}

/** The project a new diagram goes into: the one asked for (it must belong to this workspace), or the workspace's first. */
export async function resolveProject(db: Queryable, workspaceId: string, projectId: string | undefined, userId: string): Promise<string> {
  if (!projectId) return ensureDefaultProject(db, workspaceId, userId);
  const ok = await db.query(`SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [projectId, workspaceId]);
  if (ok.rows.length === 0) throw new AppError('DOMAIN_VALIDATION_FAILED', 'That project does not exist in this workspace.', { reason: 'PROJECT_NOT_FOUND' });
  return projectId;
}

export async function listProjects(pool: Pool, userId: string, workspaceId: string): Promise<ProjectSummary[]> {
  const role = await authorizeWorkspace(pool, userId, workspaceId, 'view');
  if (can(role, 'modify')) await ensureDefaultProject(pool, workspaceId, userId);
  const { rows } = await pool.query<ProjectRow>(`SELECT ${SELECT} ${FROM_PROJECTS} WHERE p.workspace_id = $1 AND p.deleted_at IS NULL ORDER BY p.created_at, p.id`, [workspaceId]);
  return rows.map(toSummary);
}

/** Which workspace a project is in, and the caller's role there (not found for anyone who may not see it). */
async function locate(db: Queryable, userId: string, projectId: string) {
  const { rows } = await db.query<{ workspace_id: string }>(`SELECT workspace_id FROM projects WHERE id = $1 AND deleted_at IS NULL`, [projectId]);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Project not found.');
  const role = await workspaceRole(db, userId, row.workspace_id);
  if (!role) throw new AppError('NOT_FOUND', 'Project not found.');
  return { workspaceId: row.workspace_id, role };
}

export async function createProject(pool: Pool, userId: string, workspaceId: string, input: { name: string; description?: string | undefined }): Promise<ProjectSummary> {
  return withTransaction(pool, async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, 'modify');
    const n = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM projects WHERE workspace_id = $1 AND deleted_at IS NULL`, [workspaceId]);
    if ((n.rows[0]?.n ?? 0) >= LIMITS.maxProjectsPerWorkspace) {
      throw new AppError('DOMAIN_VALIDATION_FAILED', `A workspace can have up to ${LIMITS.maxProjectsPerWorkspace} projects.`, { reason: 'LIMIT_EXCEEDED', limit: LIMITS.maxProjectsPerWorkspace });
    }
    const { rows } = await tx.query<{ id: string }>(`INSERT INTO projects (workspace_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id`, [workspaceId, input.name, input.description || null, userId]);
    const made = await tx.query<ProjectRow>(`SELECT ${SELECT} ${FROM_PROJECTS} WHERE p.id = $1`, [rows[0]!.id]);
    return toSummary(made.rows[0]!);
  });
}

export async function updateProject(pool: Pool, userId: string, projectId: string, input: { name?: string | undefined; description?: string | null | undefined; cover?: ProjectCover | null | undefined }): Promise<ProjectSummary> {
  return withTransaction(pool, async (tx) => {
    const { workspaceId } = await locate(tx, userId, projectId);
    await authorizeWorkspace(tx, userId, workspaceId, 'modify');
    await tx.query(
      `UPDATE projects SET name = COALESCE($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            cover = CASE WHEN $5::boolean THEN $6 ELSE cover END, updated_at = now() WHERE id = $1`,
      [projectId, input.name ?? null, input.description !== undefined, input.description || null, input.cover !== undefined, input.cover ?? null],
    );
    const { rows } = await tx.query<ProjectRow>(`SELECT ${SELECT} ${FROM_PROJECTS} WHERE p.id = $1`, [projectId]);
    return toSummary(rows[0]!);
  });
}

export async function deleteProject(pool: Pool, userId: string, projectId: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const { workspaceId } = await locate(tx, userId, projectId);
    const role = await authorizeWorkspace(tx, userId, workspaceId, 'delete');
    if (role !== 'OWNER') throw new AppError('FORBIDDEN', 'Only an owner can delete a project.');
    const n = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM projects WHERE workspace_id = $1 AND deleted_at IS NULL`, [workspaceId]);
    if ((n.rows[0]?.n ?? 0) <= 1) throw new AppError('DOMAIN_VALIDATION_FAILED', 'A workspace needs at least one project.', { reason: 'LAST_PROJECT' });
    await tx.query(`UPDATE diagrams SET deleted_at = COALESCE(deleted_at, now()) WHERE project_id = $1`, [projectId]);
    await tx.query(`UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = $1`, [projectId]);
  });
}

/** Set a diagram's icon (or clear it). A filing detail like moving: no new version, no change to its history. */
export async function setDiagramIcon(pool: Pool, userId: string, diagramId: string, icon: string | null): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<{ workspace_id: string }>(`SELECT workspace_id FROM diagrams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [diagramId]);
    const row = rows[0];
    if (!row) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
    await authorizeWorkspace(tx, userId, row.workspace_id, 'modify');
    await tx.query(`UPDATE diagrams SET icon = $2 WHERE id = $1`, [diagramId, icon]);
  });
}

/** Move a diagram to another project of the same workspace. It is a filing change: the diagram's version and history are untouched. */
export async function moveDiagram(pool: Pool, userId: string, diagramId: string, projectId: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<{ workspace_id: string }>(`SELECT workspace_id FROM diagrams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [diagramId]);
    const row = rows[0];
    if (!row) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
    await authorizeWorkspace(tx, userId, row.workspace_id, 'modify');
    await resolveProject(tx, row.workspace_id, projectId, userId);
    await tx.query(`UPDATE diagrams SET project_id = $2 WHERE id = $1`, [diagramId, projectId]);
  });
}

// ---- cards (with a tiny drawing of each diagram) ----

const MAX_PREVIEW_NODES = 40;

interface CardRow {
  id: string;
  workspace_id: string;
  project_id: string;
  workspace_name: string;
  project_name: string;
  project_cover: ProjectCover | null;
  icon: string | null;
  name: string;
  graph: unknown;
  presentation: unknown;
  updated_at: Date;
}

/** Positions of up to 40 components and the connections among them: enough to draw a thumbnail. */
function previewOf(graph: Graph, presentation: Presentation): DiagramCard['preview'] {
  const positions = presentation.nodePositions;
  const placed = graph.nodes.filter((n) => positions[n.id]).slice(0, MAX_PREVIEW_NODES);
  const index = new Map(placed.map((n, i) => [n.id, i]));
  return {
    nodes: placed.map((n) => [Math.round(positions[n.id]!.x), Math.round(positions[n.id]!.y)] as [number, number]),
    edges: graph.edges.flatMap((e) => {
      const a = index.get(e.sourceNodeId);
      const b = index.get(e.targetNodeId);
      return a !== undefined && b !== undefined ? [[a, b] as [number, number]] : [];
    }),
  };
}

function toCard(r: CardRow): DiagramCard {
  const graph = graphSchema.parse(r.graph);
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    workspaceName: r.workspace_name,
    projectName: r.project_name,
    projectCover: r.project_cover,
    icon: r.icon,
    name: r.name,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    updatedAt: r.updated_at.toISOString(),
    preview: previewOf(graph, presentationSchema.parse(r.presentation)),
  };
}

const CARD_SELECT = `d.id, d.workspace_id, d.project_id, w.name AS workspace_name, p.name AS project_name, p.cover AS project_cover, d.icon, d.name, d.graph, d.presentation, d.updated_at
  FROM diagrams d JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL JOIN projects p ON p.id = d.project_id`;

export async function listProjectDiagrams(pool: Pool, userId: string, projectId: string, limit = 100): Promise<DiagramCard[]> {
  const { workspaceId } = await locate(pool, userId, projectId);
  const { rows } = await pool.query<CardRow>(`SELECT ${CARD_SELECT} WHERE d.project_id = $1 AND d.workspace_id = $2 AND d.deleted_at IS NULL ORDER BY d.updated_at DESC, d.id LIMIT $3`, [projectId, workspaceId, limit]);
  return rows.map(toCard);
}

/** The diagrams this person worked on most recently, across every workspace they belong to. */
export async function listRecentDiagrams(pool: Pool, userId: string, limit = 8): Promise<DiagramCard[]> {
  const { rows } = await pool.query<CardRow>(
    `SELECT ${CARD_SELECT}
      WHERE d.deleted_at IS NULL AND EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = d.workspace_id AND m.user_id = $1)
      ORDER BY d.updated_at DESC, d.id LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toCard);
}

/** Totals across the diagrams this person can open (the newest 300 at most): how much there is, of what, and what is used most. */
export async function getOverview(pool: Pool, userId: string): Promise<Overview> {
  const { rows } = await pool.query<{ id: string; name: string; graph: unknown }>(
    `SELECT d.id, d.name, d.graph FROM diagrams d JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
      WHERE d.deleted_at IS NULL AND EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = d.workspace_id AND m.user_id = $1)
      ORDER BY d.updated_at DESC, d.id LIMIT 300`,
    [userId],
  );
  const kinds = new Map<string, number>();
  const used = new Map<string, { label: string; count: number }>();
  let components = 0;
  let connections = 0;
  let largest: Overview['largest'] = null;
  for (const row of rows) {
    const parsed = graphSchema.safeParse(row.graph);
    if (!parsed.success) continue;
    const graph = parsed.data;
    components += graph.nodes.length;
    connections += graph.edges.length;
    if (graph.nodes.length > 0 && (!largest || graph.nodes.length > largest.components)) largest = { id: row.id, name: row.name, components: graph.nodes.length };
    for (const n of graph.nodes) {
      kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1);
      const icon = typeof n.metadata['icon'] === 'string' ? (n.metadata['icon'] as string) : null;
      const key = icon && icon !== 'generic' ? icon : (n.technology ?? n.name);
      const seen = used.get(key);
      if (seen) seen.count += 1;
      else used.set(key, { label: n.technology ?? n.name, count: 1 });
    }
  }
  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  return {
    diagrams: rows.length,
    components,
    connections,
    byKind: [...kinds].map(([kind, count]) => ({ kind, count })).sort(byCount),
    topComponents: [...used].map(([key, v]) => ({ key, label: v.label, count: v.count })).sort(byCount).slice(0, 5),
    largest,
  };
}
