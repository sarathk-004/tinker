/** Contract limits (decision D06). Revisit after UX/provider budget checks. */
export const LIMITS = {
  maxNodes: 500,
  maxEdges: 2000,
  maxNodeNameLength: 120,
  maxTechnologyLength: 120,
  maxRelationshipLength: 120,
  maxDiagramNameLength: 160,
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
