import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  GRAPH_SCHEMA_VERSION,
  diagramCommandSchema,
  findPresentationIntegrityIssues,
  graphSchema,
  presentationSchema,
  uuidSchema,
} from '@tinker/shared';
import { AppError, parseOrThrow } from '../../../infrastructure/http/errors.ts';
import { applyCommand, downstreamNodeIds, layoutGraph, type DiagramDoc } from '../domain/index.ts';

const docSchema = z.object({ graph: graphSchema, presentation: presentationSchema });
const applySchema = docSchema.extend({ command: z.unknown() });
const downstreamSchema = z.object({ graph: graphSchema, nodeId: uuidSchema });

/** Orders -> PostgreSQL with fresh UUIDs and layout-derived positions. */
function sampleDoc(): DiagramDoc {
  const orders = randomUUID();
  const postgres = randomUUID();
  const graph = {
    schemaVersion: GRAPH_SCHEMA_VERSION as 1,
    nodes: [
      { id: orders, name: 'Orders', kind: 'SERVICE' as const, technology: 'Node.js', metadata: {} },
      { id: postgres, name: 'PostgreSQL', kind: 'DATABASE' as const, technology: 'PostgreSQL', metadata: {} },
    ],
    edges: [{ id: randomUUID(), sourceNodeId: orders, targetNodeId: postgres, relationship: 'SQL', metadata: {} }],
  };
  return { graph, presentation: { nodePositions: layoutGraph(graph), viewport: { x: 0, y: 0, zoom: 1 } } };
}

/**
 * Development-only, stateless window onto the diagram engine so changes can be seen on localhost before
 * persistence exists (I3). Registered only when NODE_ENV=development; nothing is stored or authenticated.
 * Superseded by the real command API; remove or keep behind the same flag for demos.
 */
export async function registerDevEngineRoutes(root: FastifyInstance): Promise<void> {
  await root.register(async (app) => {
    app.get('/dev/engine/sample', async () => sampleDoc());

    app.post('/dev/engine/apply', async (request) => {
      const body = parseOrThrow(applySchema, request.body, 'INVALID_REQUEST', 'Invalid document.');
      const problems = findPresentationIntegrityIssues(body.graph, body.presentation);
      if (problems.length > 0) throw new AppError('INVALID_REQUEST', 'Presentation references unknown nodes.');
      const command = parseOrThrow(diagramCommandSchema, body.command, 'INVALID_COMMAND', 'Invalid command.');
      const result = applyCommand({ graph: body.graph, presentation: body.presentation }, command, randomUUID);
      if (!result.ok) {
        throw new AppError('DOMAIN_VALIDATION_FAILED', result.error.message, { reason: result.error.reason, ...result.error.details });
      }
      return { appliedCommand: { type: command.type }, ...result.value };
    });

    app.post('/dev/engine/downstream', async (request) => {
      const body = parseOrThrow(downstreamSchema, request.body, 'INVALID_REQUEST', 'Invalid request.');
      return { nodeId: body.nodeId, downstream: downstreamNodeIds(body.graph, body.nodeId) };
    });
  });
}
