import { ProviderError } from '../ai/providers/types.ts';
import type { LiveEvents, LiveGateway, LiveOpenOptions, LiveSession, LiveToolCall, LiveToolResponse } from './live-gateway.ts';

/** A scripted provider session for tests: it records what the server sends and lets the test play the model's side. */
export interface FakeLiveSession extends LiveSession {
  audio: Uint8Array[];
  audioEnded: boolean;
  closed: boolean;
  toolResponses: LiveToolResponse[];
  options: LiveOpenOptions;
  /** The model heard words. */
  say(text: string, final?: boolean): void;
  /** The model proposes tool calls. */
  call(...calls: LiveToolCall[]): void;
  cancel(...ids: string[]): void;
  /** The provider drops the connection. */
  drop(clean?: boolean): void;
  /** Simulated backpressure towards the provider. */
  buffered: number;
}

export interface FakeLive extends LiveGateway {
  sessions: FakeLiveSession[];
  /** Make the next open() fail. */
  failNext(error: ProviderError): void;
}

export function createFakeLive(): FakeLive {
  const sessions: FakeLiveSession[] = [];
  let nextFailure: ProviderError | undefined;
  return {
    available: true,
    name: 'fake-live',
    sessions,
    failNext(error) {
      nextFailure = error;
    },
    async open(events: LiveEvents, options: LiveOpenOptions) {
      if (nextFailure) {
        const error = nextFailure;
        nextFailure = undefined;
        throw error;
      }
      let closedByProvider = false;
      const session: FakeLiveSession = {
        audio: [],
        audioEnded: false,
        closed: false,
        toolResponses: [],
        options,
        buffered: 0,
        get bufferedAmount() {
          return session.buffered;
        },
        sendAudio(chunk) {
          session.audio.push(chunk);
        },
        endAudio() {
          session.audioEnded = true;
        },
        respondToTools(responses) {
          session.toolResponses.push(...responses);
        },
        close() {
          session.closed = true;
        },
        say: (text, final = false) => events.onTranscript(text, final),
        call: (...calls) => events.onToolCalls(calls),
        cancel: (...ids) => events.onToolCancelled(ids),
        drop(clean = false) {
          if (closedByProvider) return;
          closedByProvider = true;
          session.closed = true;
          events.onClosed({ clean, reason: clean ? 'close 1000' : 'close 1006' });
        },
      };
      sessions.push(session);
      return session;
    },
  };
}
