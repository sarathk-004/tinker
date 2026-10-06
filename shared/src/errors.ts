import { z } from 'zod';

/** HTTP status per error code. Clients branch on `error.code`, never on message text. */
export const ERROR_HTTP_STATUS = {
  INVALID_REQUEST: 400,
  INVALID_COMMAND: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  DIAGRAM_NOT_FOUND: 404,
  DIAGRAM_VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_ALREADY_PROCESSING: 409,
  IDEMPOTENCY_RESULT_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  DOMAIN_VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  AI_PROVIDER_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;
export const ERROR_CODES = Object.keys(ERROR_HTTP_STATUS) as [ErrorCode, ...ErrorCode[]];
export const errorCodeSchema = z.enum(ERROR_CODES);

/**
 * Frontend retry policy (decision D03):
 * - never: fix the request; retrying cannot succeed
 * - reauthenticate: refresh credentials, then retry once with the same key
 * - reload: fetch the latest diagram, keep the draft, let the user retry intentionally
 * - same-key-backoff: retry later with the ORIGINAL Idempotency-Key and body
 * - reconcile: fetch current state; the original result is no longer replayable
 */
export type RetryPolicy = 'never' | 'reauthenticate' | 'reload' | 'same-key-backoff' | 'reconcile';

export const ERROR_RETRY_POLICY: Readonly<Record<ErrorCode, RetryPolicy>> = {
  INVALID_REQUEST: 'never',
  INVALID_COMMAND: 'never',
  UNAUTHENTICATED: 'reauthenticate',
  FORBIDDEN: 'never',
  EMAIL_NOT_VERIFIED: 'never',
  NOT_FOUND: 'never',
  DIAGRAM_NOT_FOUND: 'never',
  DIAGRAM_VERSION_CONFLICT: 'reload',
  IDEMPOTENCY_KEY_REUSED: 'never',
  REQUEST_ALREADY_PROCESSING: 'same-key-backoff',
  IDEMPOTENCY_RESULT_EXPIRED: 'reconcile',
  PAYLOAD_TOO_LARGE: 'never',
  DOMAIN_VALIDATION_FAILED: 'never',
  RATE_LIMITED: 'same-key-backoff',
  INTERNAL_ERROR: 'same-key-backoff',
  NOT_IMPLEMENTED: 'never',
  AI_PROVIDER_ERROR: 'same-key-backoff',
  SERVICE_UNAVAILABLE: 'same-key-backoff',
  AI_UNAVAILABLE: 'same-key-backoff',
  AI_TIMEOUT: 'same-key-backoff',
};

/** Machine-readable reasons carried in `details.reason` for DOMAIN_VALIDATION_FAILED (used from I2). */
export const DOMAIN_ERROR_REASONS = [
  'NODE_NOT_FOUND',
  'EDGE_NOT_FOUND',
  'DUPLICATE_EDGE',
  'SELF_LOOP_UNSUPPORTED',
  'EDGE_REQUIRED',
  'AMBIGUOUS_EDGE',
  'LIMIT_EXCEEDED',
] as const;
export type DomainErrorReason = (typeof DOMAIN_ERROR_REASONS)[number];

export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
