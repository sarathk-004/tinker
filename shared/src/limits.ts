/** Contract limits (decision D06). Revisit after UX/provider budget checks. */
export const LIMITS = {
  maxNodes: 500,
  maxEdges: 2000,
  maxNodeNameLength: 120,
  maxTechnologyLength: 120,
  maxRelationshipLength: 120,
  maxDiagramNameLength: 160,
  maxWorkspaceNameLength: 80,
  /** Free text notes on the canvas, and how long one may be. */
  maxNotes: 100,
  maxNoteChars: 2000,
  /** Team workspaces one person may own (their personal workspace is not counted). */
  maxOwnedWorkspaces: 5,
  maxWorkspaceMembers: 25,
  maxProjectsPerWorkspace: 50,
  maxProjectNameLength: 120,
  maxWorkspaceDescriptionLength: 300,
  maxCommandTextBytes: 8 * 1024,
  maxMetadataChars: 8 * 1024,
  maxMetadataKeyLength: 64,
  maxRequestBodyBytes: 1024 * 1024,
  minIdempotencyKeyLength: 8,
  maxIdempotencyKeyLength: 128,
  zoomMin: 0.05,
  zoomMax: 8,
} as const;

export const API_PREFIX = '/v1';
export const GRAPH_SCHEMA_VERSION = 1;
