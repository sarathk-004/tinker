import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  API_PREFIX,
  diagramCommandSchema,
  idempotencyKeySchema,
  presentationPatchRequestSchema,
  uuidSchema,
  versionSchema,
} from '@tinker/shared';
import type { Authenticator } from '../../../infrastructure/auth/authenticator.ts';
import { AppError, parseOrThrow } from '../../../infrastructure/http/errors.ts';

const paramsSchema = z.object({ diagramId: uuidSchema });
const commandEnvelopeSchema = z.object({ expectedVersion: versionSchema, command: z.unknown() });

function validateMutationHeadersAndParams(request: FastifyRequest): void {
  parseOrThrow(paramsSchema, request.params, 'INVALID_REQUEST', 'Invalid diagram id.');
  parseOrThrow(
    idempotencyKeySchema,
    request.headers['idempotency-key'],
    'INVALID_REQUEST',
    'A valid Idempotency-Key header is required.',
  );
}

/**
 * I1: routes authenticate first, validate the contract, then answer 501.
 * Execution (idempotency, authorization, persistence) arrives in I3 behind the same validation.
 */
export async function registerDiagramRoutes(root: FastifyInstance, authenticate: Authenticator): Promise<void> {
  // Encapsulated scope: the authentication hook protects only these routes, never /health.
  await root.register(async (app) => {
    app.addHook('onRequest', async (request) => {
      request.auth = await authenticate(request);
    });

    app.post(`${API_PREFIX}/diagrams/:diagramId/commands`, async (request) => {
      validateMutationHeadersAndParams(request);
      const envelope = parseOrThrow(commandEnvelopeSchema, request.body, 'INVALID_REQUEST', 'Invalid command request.');
      parseOrThrow(diagramCommandSchema, envelope.command, 'INVALID_COMMAND', 'Invalid command.');
      throw new AppError('NOT_IMPLEMENTED', 'Command execution is not implemented yet.');
    });

    app.patch(`${API_PREFIX}/diagrams/:diagramId/presentation`, async (request) => {
      validateMutationHeadersAndParams(request);
      parseOrThrow(presentationPatchRequestSchema, request.body, 'INVALID_REQUEST', 'Invalid presentation update.');
      throw new AppError('NOT_IMPLEMENTED', 'Presentation updates are not implemented yet.');
    });
  });
}
