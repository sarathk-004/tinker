import { ProviderError } from '../ai/providers/types.ts';

/**
 * The seam between a voice session and the realtime speech model. Provider specifics (Gemini Live's JSON, WebSocket) stay behind
 * this interface so the session logic, quotas and tests never depend on them. Everything the model sends is UNTRUSTED.
 */
export interface LiveToolCall {
  /** Provider call id. Stable for one proposal; the session de-duplicates on it. */
  id: string;
  name: string;
  args: unknown;
}

export interface LiveEvents {
  /** What the user said so far in the current turn (`final: true` once the turn ended). Provisional until final. */
  onTranscript(text: string, final: boolean): void;
  /** The model's explicit tool calls: the only thing that can lead to an edit. */
  onToolCalls(calls: LiveToolCall[]): void;
  /** The provider withdrew calls it had not finished (the user interrupted). */
  onToolCancelled(ids: string[]): void;
  /** The provider session ended (normally or not). After this no more events arrive. */
  onClosed(info: { clean: boolean; reason: string }): void;
}

export interface LiveToolResponse {
  id: string;
  name: string;
  /** Short plain text the model may use; it is never shown to the user. */
  result: string;
}

export interface LiveSession {
  /** Raw 16-bit little-endian PCM, 16 kHz, mono. */
  sendAudio(chunk: Uint8Array): void;
  /** The user stopped speaking for good. */
  endAudio(): void;
  respondToTools(responses: LiveToolResponse[]): void;
  /** Bytes queued towards the provider and not yet sent (backpressure signal). */
  readonly bufferedAmount: number;
  close(): void;
}

export interface LiveOpenOptions {
  /** Plain-text hints (component names) so the model hears the user's vocabulary correctly. */
  componentNames: string[];
  signal: AbortSignal;
}

export interface LiveGateway {
  /** False when voice is not configured (no key): sessions can connect but `start` answers "not available". */
  readonly available: boolean;
  readonly name: string;
  /** Resolves once the provider session is ready for audio. Rejects with ProviderError. */
  open(events: LiveEvents, options: LiveOpenOptions): Promise<LiveSession>;
}

export const LIVE_TOOLS = {
  edit: 'edit_diagram',
  ask: 'ask_about_diagram',
} as const;

export const disabledLiveGateway: LiveGateway = {
  available: false,
  name: 'disabled',
  async open() {
    throw new ProviderError('disabled', 'Voice is not configured on this server.');
  },
};
