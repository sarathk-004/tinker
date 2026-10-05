/**
 * Provider gateway: the only place that knows a model vendor exists. Provider types never leak into the contracts or the
 * frontend. A provider returns UNTRUSTED parsed JSON; the application validates it before anything else happens.
 */
export type ProviderErrorKind =
  /** The deadline passed (ours or the provider's). */
  | 'timeout'
  /** 5xx / network / provider outage. Transient. */
  | 'unavailable'
  /** Provider quota or rate limit. Transient. */
  | 'rate_limited'
  /** Our credentials or model name are not accepted. Not the caller's problem and not transient. */
  | 'auth'
  /** The provider refused or could not process this request (safety block, 4xx). */
  | 'rejected'
  /** Output was not parseable / not what we asked for. */
  | 'bad_output'
  /** No provider configured. */
  | 'disabled';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    /** Safe, short diagnostic for server logs only (never the key, never user text). */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** Worth one more attempt within the same deadline. */
  get transient(): boolean {
    return this.kind === 'unavailable' || this.kind === 'rate_limited' || this.kind === 'bad_output';
  }
}

export interface ProviderRequest {
  systemInstruction: string;
  /** Diagram, recent turns and the request, already assembled (and size-bounded) by the prompt builder. */
  content: string;
  /** JSON Schema the output must follow. */
  responseSchema: Record<string, unknown>;
}

export interface ProviderResult {
  /** Parsed JSON from the model. UNTRUSTED. */
  output: unknown;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface InterpretationProvider {
  /** False for the disabled provider: lets the API tell the UI that AI commands are off. */
  readonly available: boolean;
  readonly name: string;
  /** Must stop work and reject promptly when `signal` aborts; late results are ignored by the caller either way. */
  interpret(request: ProviderRequest, options: { signal: AbortSignal }): Promise<ProviderResult>;
}
