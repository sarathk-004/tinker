import {
  commandResponseSchema,
  deleteDiagramResponseSchema,
  diagramDetailSchema,
  diagramListResponseSchema,
  ERROR_RETRY_POLICY,
  aiAskResponseSchema,
  aiCommandResponseSchema,
  conversationResponseSchema,
  errorEnvelopeSchema,
  meResponseSchema,
  type AiAskResponse,
  type AiCommandResponse,
  type CommandResponse,
  type ConversationResponse,
  type DeleteDiagramResponse,
  type DiagramDetail,
  type DiagramListResponse,
  type ErrorCode,
  type MeResponse,
} from '../contracts';

/** Minimal shape of a runtime schema (the contracts' Zod schemas satisfy it), so this file needs no direct Zod import. */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** An error answered by the API (or a transport failure) in a shape the UI can branch on (never on message text). */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE' | 'TIMEOUT',
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
    /** True when the failure may be transient: the caller can retry later with the SAME idempotency key. */
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthSource {
  getAccessToken(): Promise<string | null>;
  /** Try to obtain a fresh token (e.g. refresh the session). Null when impossible. */
  refresh(): Promise<string | null>;
  /** Called when the API keeps rejecting our credentials. */
  onUnauthorized(): void;
}

export interface ApiClientOptions {
  baseUrl: string;
  auth: AuthSource;
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
}

/** Per-request overrides. AI requests must not auto-retry provider failures (each attempt can take the full deadline). */
export interface RequestOptions {
  timeoutMs?: number;
  /** Error codes that are reported to the caller immediately instead of being retried automatically. */
  noRetryCodes?: readonly ErrorCode[];
}

export interface MutationSpec {
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Stable for the whole logical operation: retries MUST reuse the same key and body. */
  idempotencyKey: string;
}

export interface Replayable<T> {
  data: T;
  /** True when the server returned a stored result of an earlier identical request. */
  replayed: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 5;
  const timeoutMs = options.timeoutMs ?? 15_000;

  /** One HTTP round trip. Throws ApiError (transport failures are retryable). */
  async function once(method: string, path: string, body: unknown, key: string | undefined, token: string | null, timeout: number): Promise<{ status: number; json: unknown; replayed: boolean; retryAfterMs?: number }> {
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;

    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const timedOut = (error as { name?: string }).name === 'TimeoutError';
      throw new ApiError(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', timedOut ? 'The server took too long to answer.' : 'Cannot reach the server.', 0, undefined, undefined, true);
    }

    let json: unknown = undefined;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      status: response.status,
      json,
      replayed: response.headers.get('idempotent-replayed') === 'true' || (typeof json === 'object' && json !== null && (json as { replayed?: unknown }).replayed === true),
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
    };
  }

  function toError(status: number, json: unknown): ApiError {
    const parsed = errorEnvelopeSchema.safeParse(json);
    if (parsed.success) {
      const e = parsed.data.error;
      return new ApiError(e.code, e.message, status, e.details, e.requestId, ERROR_RETRY_POLICY[e.code] === 'same-key-backoff');
    }
    // Not our envelope (proxy error page, dev server hiccup): treat 5xx as transient, anything else as a bad response.
    return new ApiError(status >= 500 ? 'NETWORK_ERROR' : 'BAD_RESPONSE', `Unexpected response (HTTP ${status}).`, status, undefined, undefined, status >= 500);
  }

  /**
   * Request with transport-level resilience: transient failures are retried with exponential backoff and the same
   * Idempotency-Key (so a retried write can never apply twice); a 401 triggers one credential refresh.
   */
  async function request<T>(method: string, path: string, body: unknown, key: string | undefined, schema: Schema<T>, opts: RequestOptions = {}): Promise<Replayable<T>> {
    let refreshed = false;
    let lastError: ApiError | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let token = await options.auth.getAccessToken();
      let result;
      try {
        result = await once(method, path, body, key, token, opts.timeoutMs ?? timeoutMs);
      } catch (error) {
        lastError = error as ApiError;
        await sleep(backoff(attempt));
        continue;
      }

      if (result.status >= 200 && result.status < 300) {
        const parsed = schema.safeParse(result.json);
        if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'The server answered in an unexpected format.', result.status);
        return { data: parsed.data, replayed: result.replayed };
      }

      let error = toError(result.status, result.json);
      if (error.retryable && error.code !== 'NETWORK_ERROR' && opts.noRetryCodes?.includes(error.code as ErrorCode)) {
        error = new ApiError(error.code, error.message, error.status, error.details, error.requestId, false);
      }
      if (error.code === 'UNAUTHENTICATED') {
        if (!refreshed) {
          refreshed = true;
          token = await options.auth.refresh();
          if (token) {
            attempt -= 1; // the refresh does not consume a retry
            continue;
          }
        }
        options.auth.onUnauthorized();
        throw error;
      }
      if (!error.retryable) throw error;
      lastError = error;
      await sleep(result.retryAfterMs ?? backoff(attempt));
    }
    throw lastError ?? new ApiError('NETWORK_ERROR', 'Cannot reach the server.', 0, undefined, undefined, true);
  }

  const backoff = (attempt: number) => Math.min(4_000, 300 * 2 ** attempt) + Math.floor(Math.random() * 150);

  return {
    conversation: (diagramId: string) =>
      request('GET', `/v1/diagrams/${diagramId}/conversation`, undefined, undefined, conversationResponseSchema).then((r) => r.data as ConversationResponse),
    /** Read-only advice: nothing is mutated, so no idempotency key and a network retry is safe. */
    ask: (diagramId: string, question: string, conversationId?: string) =>
      request('POST', `/v1/diagrams/${diagramId}/ai/ask`, { question, ...(conversationId ? { conversationId } : {}) }, undefined, aiAskResponseSchema, {
        timeoutMs: 28_000,
        noRetryCodes: ['AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_UNAVAILABLE', 'RATE_LIMITED'],
      }).then((r) => r.data as AiAskResponse),
    me: () => request('GET', '/v1/me', undefined, undefined, meResponseSchema).then((r) => r.data as MeResponse),
    listDiagrams: (workspaceId: string) =>
      request('GET', `/v1/workspaces/${workspaceId}/diagrams`, undefined, undefined, diagramListResponseSchema).then((r) => r.data as DiagramListResponse),
    loadDiagram: (diagramId: string) => request('GET', `/v1/diagrams/${diagramId}`, undefined, undefined, diagramDetailSchema).then((r) => r.data as DiagramDetail),
    /** Durable writes. The caller owns the idempotency key and the body so a retry (here or later) is byte-identical. */
    createDiagram: (workspaceId: string, name: string, idempotencyKey: string) =>
      request('POST', `/v1/workspaces/${workspaceId}/diagrams`, { name }, idempotencyKey, diagramDetailSchema) as Promise<Replayable<DiagramDetail>>,
    mutate: {
      command: (spec: MutationSpec) => request(spec.method, spec.path, spec.body, spec.idempotencyKey, commandResponseSchema) as Promise<Replayable<CommandResponse>>,
      detail: (spec: MutationSpec) => request(spec.method, spec.path, spec.body, spec.idempotencyKey, diagramDetailSchema) as Promise<Replayable<DiagramDetail>>,
      /** Typed command. 28 s budget (the server's deadline is 15 s); provider failures surface at once for the user to decide. */
      ai: (spec: MutationSpec) =>
        request(spec.method, spec.path, spec.body, spec.idempotencyKey, aiCommandResponseSchema, {
          timeoutMs: 28_000,
          noRetryCodes: ['AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_UNAVAILABLE', 'RATE_LIMITED'],
        }) as Promise<Replayable<AiCommandResponse>>,
      deleted: (spec: MutationSpec) => request(spec.method, spec.path, spec.body, spec.idempotencyKey, deleteDiagramResponseSchema) as Promise<Replayable<DeleteDiagramResponse>>,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
