import type { DomainErrorReason, Graph, Presentation } from '@tinker/shared';

/** The unit every command transforms: graph semantics plus presentation (positions, viewport). */
export interface DiagramDoc {
  graph: Graph;
  presentation: Presentation;
}

export interface DomainError {
  reason: DomainErrorReason;
  message: string;
  details?: Record<string, unknown>;
}

export type DomainResult<T> = { ok: true; value: T } | { ok: false; error: DomainError };

/** Injected so the engine never touches the database, clock or randomness itself. */
export type NewId = () => string;

export const ok = <T>(value: T): DomainResult<T> => ({ ok: true, value });
export const fail = (
  reason: DomainErrorReason,
  message: string,
  details?: Record<string, unknown>,
): DomainResult<never> => ({ ok: false, error: { reason, message, ...(details ? { details } : {}) } });
