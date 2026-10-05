import { ZodError, type ZodType } from 'zod';
import { ERROR_HTTP_STATUS, type ErrorCode, type ErrorEnvelope } from '@tinker/shared';

/** Error with a contract code. Thrown by handlers; mapped to the envelope by the error handler. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export function zodDetails(error: ZodError): Record<string, unknown> {
  // Path + message only: never echo submitted values.
  return { issues: error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

/** Parse untrusted input; failure becomes an AppError with the given contract code. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, code: ErrorCode, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(code, message, zodDetails(result.error));
  return result.data;
}

interface FastifyLikeError {
  code?: string;
  statusCode?: number;
}

export function toErrorResponse(error: unknown, requestId: string): { status: number; body: ErrorEnvelope } {
  const make = (code: ErrorCode, message: string, details?: Record<string, unknown>) => ({
    status: ERROR_HTTP_STATUS[code],
    body: { error: { code, message, requestId, ...(details ? { details } : {}) } },
  });

  if (error instanceof AppError) return make(error.code, error.message, error.details);
  if (error instanceof ZodError) return make('INVALID_REQUEST', 'The request is invalid.', zodDetails(error));

  const fe = error as FastifyLikeError;
  if (fe?.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || fe?.statusCode === 413) {
    return make('PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  if (typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    return make('INVALID_REQUEST', 'The request is malformed.');
  }
  return make('INTERNAL_ERROR', 'Internal server error.');
}
