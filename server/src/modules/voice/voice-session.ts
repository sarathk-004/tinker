import { createHash, randomUUID } from 'node:crypto';
import {
  VOICE_AUDIO,
  VOICE_CLOSE,
  VOICE_LIMITS,
  aiAskRequestSchema,
  aiCommandRequestSchema,
  voiceClientMessageSchema,
  type AiAskResponse,
  type AiCommandResponse,
  type ErrorCode,
  type VoiceCloseReason,
  type VoiceResult,
  type VoiceServerMessage,
} from '@tinker/shared';
import type { TokenAuthenticator } from '../../infrastructure/auth/authenticator.ts';
import { AppError, toErrorResponse } from '../../infrastructure/http/errors.ts';
import type { RateLimiter } from '../../infrastructure/http/rate-limiter.ts';
import { askAdvice } from '../ai/application/advice-service.ts';
import { executeAiCommand, type AiDeps } from '../ai/application/ai-service.ts';
import { latestConversation } from '../ai/persistence/conversations.ts';
import { ProviderError } from '../ai/providers/types.ts';
import { presentOutcome } from '../diagrams/application/diagram-service.ts';
import { getDiagramRow } from '../diagrams/persistence/diagrams.ts';
import { authorizeDiagram } from '../workspaces/access.ts';
import { LIVE_TOOLS, type LiveGateway, type LiveSession, type LiveToolCall } from './live-gateway.ts';

/** What the session needs from the network layer. The Fastify route adapts a real WebSocket to this. */
export interface VoiceSocket {
  send(text: string): void;
  close(code: number, reason?: string): void;
}

export interface VoiceSessionLimits {
  helloTimeoutMs: number;
  maxSessionMs: number;
  idleMs: number;
  /** Housekeeping interval: expiry, idleness and permission checks. */
  tickMs: number;
  authCheckMs: number;
  maxAudioBytesPerSecond: number;
  maxChunkBytes: number;
  maxPendingProposals: number;
  /** Bytes queued towards the model beyond which audio frames are dropped / the session is closed. */
  dropAboveBytes: number;
  closeAboveBytes: number;
  openTimeoutMs: number;
}

export const DEFAULT_VOICE_LIMITS: VoiceSessionLimits = {
  helloTimeoutMs: VOICE_LIMITS.helloTimeoutMs,
  maxSessionMs: VOICE_LIMITS.maxSessionMs,
  idleMs: VOICE_LIMITS.idleMs,
  tickMs: 1_000,
  authCheckMs: 15_000,
  maxAudioBytesPerSecond: VOICE_LIMITS.maxAudioBytesPerSecond,
  maxChunkBytes: VOICE_AUDIO.maxChunkBytes,
  maxPendingProposals: VOICE_LIMITS.maxPendingProposals,
  dropAboveBytes: 1_000_000,
  closeAboveBytes: 4_000_000,
  openTimeoutMs: 12_000,
};

/** Who is connected: at most one session per user, and a server-wide cap. Shared by every session of one app instance. */
export interface VoiceRegistry {
  byUser: Map<string, VoiceSession>;
  /** Sockets that connected but have not authenticated yet. */
  unauthenticated: number;
  maxSessions: number;
  maxUnauthenticated: number;
}
export const createVoiceRegistry = (maxSessions: number, maxUnauthenticated = 20): VoiceRegistry => ({ byUser: new Map(), unauthenticated: 0, maxSessions, maxUnauthenticated });

export interface VoiceDeps {
  ai: AiDeps;
  authenticate: TokenAuthenticator;
  /** Expiry (epoch seconds) of an ALREADY VERIFIED token. */
  tokenExpiry: (token: string) => number | null;
  /** The speech model this person's voice session runs on (their own key, or the server's). Resolved when listening starts. */
  liveFor: (userId: string) => Promise<LiveGateway>;
  registry: VoiceRegistry;
  limits: VoiceSessionLimits;
  rateLimiter: RateLimiter;
  now?: () => number;
}

interface Proposal {
  callId: string;
  operationId: string;
  kind: 'EDIT' | 'ASK';
  text: string;
}

const MAX_SEEN = 500;
/** Two requests of the same kind this close in words, this close in time, are one request spoken once. */
const ECHO_WINDOW_MS = 10_000;
const ECHO_SIMILARITY = 0.7;
const wordSet = (text: string): Set<string> => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * One voice session (one WebSocket). Transport-agnostic so it can be tested without a network.
 *
 * Safety properties (decision D08):
 *  - authenticated by the first message (never a URL), re-checked on a timer, and permission is re-read from the database;
 *  - audio is bounded (chunk size, sustained rate, provider backpressure, duration, idleness);
 *  - only an explicit, finalized tool call from the model becomes a proposal; transcripts are display only;
 *  - a proposal runs through the SAME services as typed commands (idempotent, version-checked, atomic);
 *  - a tool call id is applied once, even if the model repeats it, and an id never carries over to a new session.
 */
export class VoiceSession {
  readonly id = randomUUID();
  private readonly now: () => number;
  private readonly startedAt: number;
  private chain: Promise<void> = Promise.resolve();
  private state: 'new' | 'ready' | 'closed' = 'new';
  private userId: string | undefined;
  private diagramId: string | undefined;
  private version = 0;
  private conversationId: string | undefined;
  private tokenExpiry = 0;
  private live: LiveSession | undefined;
  private opening: AbortController | undefined;
  private listening = false;
  private stopping = false;
  private readonly seen = new Set<string>();
  private readonly recent: Array<{ callId: string; at: number; kind: 'EDIT' | 'ASK'; words: Set<string> }> = [];
  private readonly queue: Proposal[] = [];
  private running = false;
  private counter = 0;
  private helloTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private lastActivity: number;
  private lastAuthCheck: number;
  private budget: number;
  private budgetAt: number;
  private newCounted = true;
  private stats = { audioBytes: 0, droppedFrames: 0, proposals: 0, applied: 0, echoes: 0 };

  constructor(
    private readonly deps: VoiceDeps,
    private readonly socket: VoiceSocket,
  ) {
    this.now = deps.now ?? Date.now;
    this.startedAt = this.lastActivity = this.lastAuthCheck = this.budgetAt = this.now();
    this.budget = deps.limits.maxAudioBytesPerSecond * 2;
    deps.registry.unauthenticated += 1;
    this.helloTimer = setTimeout(() => this.close('BAD_PROTOCOL', 'No hello message arrived in time.'), deps.limits.helloTimeoutMs);
  }

  // ---------- inputs from the network layer ----------

  /** A text frame. Messages are handled strictly in order. */
  onText(raw: string): void {
    if (this.state === 'closed') return;
    if (raw.length > VOICE_LIMITS.maxTextFrameBytes && this.state !== 'new') return this.close('BAD_PROTOCOL', 'Message too large.');
    this.chain = this.chain.then(() => this.handleText(raw)).catch((error) => this.fail(error));
  }

  /** A binary frame: audio. */
  onBinary(frame: Uint8Array): void {
    if (this.state !== 'ready') return;
    const { limits } = this.deps;
    if (frame.byteLength === 0 || frame.byteLength > limits.maxChunkBytes || frame.byteLength % 2 !== 0) return this.close('BAD_PROTOCOL', 'Invalid audio frame.');
    if (!this.listening || !this.live || this.stopping) return; // not listening: ignore stray frames
    const t = this.now();
    this.budget = Math.min(limits.maxAudioBytesPerSecond * 2, this.budget + ((t - this.budgetAt) / 1000) * limits.maxAudioBytesPerSecond);
    this.budgetAt = t;
    if (frame.byteLength > this.budget) return this.close('QUOTA', 'Audio is arriving faster than real time.');
    this.budget -= frame.byteLength;
    this.lastActivity = t;
    if (this.live.bufferedAmount > limits.closeAboveBytes) return this.close('QUOTA', 'The voice connection is too slow.');
    if (this.live.bufferedAmount > limits.dropAboveBytes) {
      this.stats.droppedFrames += 1;
      return;
    }
    this.stats.audioBytes += frame.byteLength;
    this.live.sendAudio(frame);
  }

  /** The network connection ended. Nothing is sent; work already committed stays committed. */
  onSocketClosed(): void {
    this.shutdown('NORMAL', false);
  }

  /** Close from the server side (replaced, expired, quota...). */
  close(reason: VoiceCloseReason, message?: string): void {
    if (this.state === 'closed') return;
    if (message && reason !== 'NORMAL') this.send({ type: 'error', code: reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : reason === 'FORBIDDEN' ? 'FORBIDDEN' : reason === 'NOT_FOUND' ? 'DIAGRAM_NOT_FOUND' : reason === 'QUOTA' ? 'RATE_LIMITED' : reason === 'UNAVAILABLE' ? 'SERVICE_UNAVAILABLE' : 'INVALID_REQUEST', message, fatal: true });
    this.send({ type: 'closing', reason });
    this.shutdown(reason, true);
  }

  // ---------- handling ----------

  private async handleText(raw: string): Promise<void> {
    if (this.state === 'closed') return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.close('BAD_PROTOCOL', 'Messages must be JSON.');
    }
    const parsed = voiceClientMessageSchema.safeParse(json);
    if (!parsed.success) return this.close('BAD_PROTOCOL', 'Unknown or malformed message.');
    const message = parsed.data;
    if (this.state === 'new') {
      if (message.type !== 'hello') return this.close('BAD_PROTOCOL', 'The first message must be hello.');
      return this.hello(message);
    }
    switch (message.type) {
      case 'hello':
        return this.close('BAD_PROTOCOL', 'Already connected.');
      case 'auth':
        return this.refreshAuth(message.token);
      case 'context':
        this.version = message.version;
        return;
      case 'start':
        return this.start();
      case 'stop':
        return this.stop();
      case 'cancel':
        return this.cancelQueued();
      case 'ping':
        this.send({ type: 'pong' });
        return;
    }
  }

  private async hello(message: { token: string; diagramId: string; version: number }): Promise<void> {
    const { registry } = this.deps;
    clearTimeout(this.helloTimer);
    let auth;
    try {
      auth = await this.deps.authenticate(message.token);
    } catch (error) {
      const unavailable = error instanceof AppError && error.code === 'SERVICE_UNAVAILABLE';
      return this.close(unavailable ? 'UNAVAILABLE' : 'UNAUTHENTICATED', unavailable ? 'Sign-in is temporarily unavailable.' : 'Invalid or expired credentials.');
    }
    try {
      this.deps.rateLimiter.check(auth.userId);
      await authorizeDiagram(this.deps.ai.pool, auth.userId, message.diagramId, 'view');
    } catch (error) {
      if (error instanceof AppError) return this.close(error.code === 'FORBIDDEN' ? 'FORBIDDEN' : error.code === 'RATE_LIMITED' ? 'QUOTA' : 'NOT_FOUND', error.message);
      throw error;
    }
    if (this.state !== 'new') return; // the connection closed while we were authenticating
    const existing = registry.byUser.get(auth.userId);
    if (!existing && registry.byUser.size >= registry.maxSessions) return this.close('QUOTA', 'Too many voice sessions right now. Try again shortly.');
    existing?.close('REPLACED', 'This voice session was replaced by a newer one.');

    this.userId = auth.userId;
    this.diagramId = message.diagramId;
    this.version = message.version;
    this.tokenExpiry = this.deps.tokenExpiry(message.token) ?? Math.floor(this.now() / 1000) + 300;
    const conversation = await latestConversation(this.deps.ai.pool, message.diagramId, auth.userId, 1);
    this.conversationId = conversation.conversationId ?? undefined;
    if (this.state !== 'new') return; // closed while we were setting up
    this.state = 'ready';
    this.leaveNew();
    registry.byUser.set(auth.userId, this);
    this.lastActivity = this.lastAuthCheck = this.now();
    this.tickTimer = setInterval(() => void this.tick(), this.deps.limits.tickMs);
    this.send({
      type: 'ready',
      sessionId: this.id,
      maxSessionMs: this.deps.limits.maxSessionMs,
      audio: { format: VOICE_AUDIO.format, sampleRate: VOICE_AUDIO.sampleRate, channels: VOICE_AUDIO.channels, maxChunkBytes: this.deps.limits.maxChunkBytes },
    });
  }

  private async refreshAuth(token: string): Promise<void> {
    try {
      const auth = await this.deps.authenticate(token);
      if (auth.userId !== this.userId) return this.close('UNAUTHENTICATED', 'Credentials belong to a different user.');
      this.tokenExpiry = Math.max(this.tokenExpiry, this.deps.tokenExpiry(token) ?? 0);
    } catch {
      this.close('UNAUTHENTICATED', 'Invalid or expired credentials.');
    }
  }

  private async start(): Promise<void> {
    if (this.listening || this.opening) return;
    this.stopping = false;
    const gateway = await this.deps.liveFor(this.userId!);
    if (!gateway.available) {
      this.send({ type: 'error', code: 'AI_UNAVAILABLE', message: 'Voice is not available right now. Typing still works.', fatal: false });
      return;
    }
    // The daily allowance: one unit per voice session actually opened (the speech model runs for the whole session).
    try {
      await this.deps.ai.ai.usage.consume(this.userId!, 'VOICE');
    } catch (error) {
      if (error instanceof AppError && error.code === 'DAILY_LIMIT_REACHED') {
        this.send({ type: 'error', code: 'DAILY_LIMIT_REACHED', message: error.message, fatal: false });
        return;
      }
      throw error;
    }
    const diagram = await getDiagramRow(this.deps.ai.pool, this.diagramId!);
    const names = diagram?.graph.nodes.map((n) => n.name) ?? [];
    const opening = new AbortController();
    this.opening = opening;
    const timer = setTimeout(() => opening.abort(), this.deps.limits.openTimeoutMs);
    try {
      const live = await gateway.open(
        {
          onTranscript: (text, final) => {
            if (this.state !== 'ready') return;
            this.lastActivity = this.now();
            this.send({ type: 'transcript', text: clip(text, 500), final });
          },
          onToolCalls: (calls) => this.onToolCalls(calls),
          onToolCancelled: (ids) => this.onToolCancelled(ids),
          onClosed: (info) => {
            if (this.state !== 'ready' || this.live === undefined) return;
            this.deps.ai.log?.('voice provider closed', { clean: info.clean, reason: info.reason, session: this.id });
            this.live = undefined;
            this.listening = false;
            this.send({ type: 'error', code: 'AI_UNAVAILABLE', message: 'The voice connection to the model ended. Press the microphone to start again.', fatal: false });
          },
        },
        { componentNames: names, signal: opening.signal },
      );
      if (this.state !== 'ready') return live.close();
      this.live = live;
      this.listening = true;
      this.lastActivity = this.now();
      this.send({ type: 'listening' });
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : 'unavailable';
      this.deps.ai.log?.('voice provider failure', { kind, detail: error instanceof ProviderError ? error.detail : undefined, session: this.id });
      this.send({ type: 'error', code: kind === 'timeout' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', message: 'Voice is not available right now. Typing still works.', fatal: false });
    } finally {
      clearTimeout(timer);
      this.opening = undefined;
    }
  }

  private async stop(): Promise<void> {
    this.opening?.abort();
    if (!this.listening || !this.live) return;
    this.stopping = true;
    this.live.endAudio();
    this.finishStopIfIdle();
  }

  private finishStopIfIdle(): void {
    if (!this.stopping || this.running || this.queue.length > 0) return;
    this.live?.close();
    this.live = undefined;
    this.listening = false;
    this.stopping = false;
  }

  private cancelQueued(): void {
    for (const proposal of this.queue.splice(0)) this.sendResult({ operationId: proposal.operationId, status: 'ERROR', kind: proposal.kind, error: { code: 'INVALID_REQUEST', message: 'Cancelled.' } });
  }

  // ---------- proposals ----------

  private onToolCalls(calls: LiveToolCall[]): void {
    if (this.state !== 'ready') return;
    for (const call of calls) {
      if (this.seen.has(call.id)) continue; // the model repeated a call: applied once
      this.seen.add(call.id);
      if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value as string);
      const operationId = `${this.id}:${call.id}`;
      const args = call.args && typeof call.args === 'object' ? (call.args as Record<string, unknown>) : {};
      let proposal: Proposal | null = null;
      if (call.name === LIVE_TOOLS.edit) {
        const parsed = aiCommandRequestSchema.shape.input.shape.text.safeParse(args['request']);
        if (parsed.success) proposal = { callId: call.id, operationId, kind: 'EDIT', text: parsed.data };
      } else if (call.name === LIVE_TOOLS.ask) {
        const parsed = aiAskRequestSchema.shape.question.safeParse(args['question']);
        if (parsed.success) proposal = { callId: call.id, operationId, kind: 'ASK', text: parsed.data };
      }
      if (!proposal) {
        this.reject(call, operationId, call.name === LIVE_TOOLS.ask ? 'ASK' : 'EDIT', 'INVALID_REQUEST', 'The request could not be understood.');
        continue;
      }
      // Live finding (2026-10-06): the model sometimes calls the tool twice, with different ids, for ONE utterance. A request that
      // says nearly the same thing as one made moments ago is the same request, not a new one.
      if (this.isEcho(proposal)) {
        this.stats.echoes += 1;
        this.live?.respondToTools([{ id: call.id, name: call.name, result: 'Already handled.' }]);
        continue;
      }
      if (this.queue.length + (this.running ? 1 : 0) >= this.deps.limits.maxPendingProposals) {
        this.reject(call, operationId, proposal.kind, 'RATE_LIMITED', 'Too many requests at once. Please wait a moment.');
        continue;
      }
      this.stats.proposals += 1;
      this.recent.push({ callId: call.id, at: this.now(), kind: proposal.kind, words: wordSet(proposal.text) });
      if (this.recent.length > 8) this.recent.shift();
      this.queue.push(proposal);
    }
    void this.drain();
  }

  private isEcho(proposal: Proposal): boolean {
    const words = wordSet(proposal.text);
    const t = this.now();
    return this.recent.some((r) => r.kind === proposal.kind && t - r.at <= ECHO_WINDOW_MS && similarity(r.words, words) >= ECHO_SIMILARITY);
  }

  private onToolCancelled(ids: string[]): void {
    for (const id of ids) {
      const index = this.queue.findIndex((p) => p.callId === id);
      if (index < 0) continue;
      const [proposal] = this.queue.splice(index, 1);
      this.sendResult({ operationId: proposal!.operationId, status: 'ERROR', kind: proposal!.kind, error: { code: 'INVALID_REQUEST', message: 'Cancelled.' } });
    }
  }

  private reject(call: LiveToolCall, operationId: string, kind: 'EDIT' | 'ASK', code: ErrorCode, message: string): void {
    this.sendResult({ operationId, status: 'ERROR', kind, error: { code, message } });
    this.live?.respondToTools([{ id: call.id, name: call.name, result: `Not done: ${message}` }]);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.state === 'ready' && this.queue.length > 0) await this.run(this.queue.shift()!);
    } finally {
      this.running = false;
      this.finishStopIfIdle();
    }
  }

  /** Stable per proposal and never shared with another session. */
  private idempotencyKey(proposal: Proposal): string {
    return `voice-${createHash('sha256').update(`${this.id}\n${proposal.callId}`).digest('hex').slice(0, 40)}`;
  }

  private async run(proposal: Proposal): Promise<void> {
    this.send({ type: 'proposal', operationId: proposal.operationId, kind: proposal.kind, request: clip(proposal.text, 500) });
    const actor = { userId: this.userId!, requestId: `voice-${this.id}-${++this.counter}` };
    let result: VoiceResult;
    let summary: string;
    try {
      if (this.now() / 1000 >= this.tokenExpiry) throw new AppError('UNAUTHENTICATED', 'Your session expired. Reconnect to continue.');
      if (proposal.kind === 'EDIT') {
        const outcome = presentOutcome(
          await executeAiCommand(this.deps.ai, actor, this.diagramId!, this.idempotencyKey(proposal), {
            expectedVersion: this.version,
            ...(this.conversationId ? { conversationId: this.conversationId } : {}),
            input: { type: 'TEXT', text: proposal.text },
          }),
          actor.requestId,
        );
        if (outcome.status === 200) {
          const response = outcome.body as AiCommandResponse;
          this.conversationId = response.conversationId;
          if (response.status === 'APPLIED') {
            this.version = response.diagram.version;
            this.stats.applied += 1;
          }
          result = { operationId: proposal.operationId, status: 'OK', kind: 'EDIT', response };
          summary = response.status === 'APPLIED' ? `Applied: ${response.interpretation.commands.map((c) => c.summary).join('; ')}` : `Needs clarification: ${response.question}`;
        } else {
          const error = (outcome.body as { error: { code: ErrorCode; message: string } }).error;
          result = { operationId: proposal.operationId, status: 'ERROR', kind: 'EDIT', error: { code: error.code, message: error.message } };
          summary = `Not done: ${error.message}`;
        }
      } else {
        const response: AiAskResponse = await askAdvice(this.deps.ai, actor, this.diagramId!, {
          ...(this.conversationId ? { conversationId: this.conversationId } : {}),
          question: proposal.text,
        });
        this.conversationId = response.conversationId;
        result = { operationId: proposal.operationId, status: 'OK', kind: 'ASK', response };
        summary = 'Answered the question.';
      }
    } catch (error) {
      const { body } = toErrorResponse(error, actor.requestId);
      result = { operationId: proposal.operationId, status: 'ERROR', kind: proposal.kind, error: { code: body.error.code, message: body.error.message } };
      summary = `Not done: ${body.error.message}`;
      if (body.error.code === 'INTERNAL_ERROR') this.deps.ai.log?.('voice proposal failed', { session: this.id });
      // Access taken away mid-session: say so and stop listening (typing and manual editing are unaffected).
      if (body.error.code === 'DIAGRAM_NOT_FOUND') {
        this.sendResult(result);
        return this.close('NOT_FOUND', 'This diagram is no longer available to you.');
      }
    }
    // A request that failed may be said again (for instance after a version conflict): it is not an echo.
    if (result.status === 'ERROR') {
      const index = this.recent.findIndex((r) => r.callId === proposal.callId);
      if (index >= 0) this.recent.splice(index, 1);
    }
    this.sendResult(result);
    this.live?.respondToTools([{ id: proposal.callId, name: proposal.kind === 'EDIT' ? LIVE_TOOLS.edit : LIVE_TOOLS.ask, result: summary }]);
  }

  // ---------- housekeeping ----------

  private async tick(): Promise<void> {
    if (this.state !== 'ready') return;
    const t = this.now();
    const { limits } = this.deps;
    if (t - this.startedAt >= limits.maxSessionMs) return this.close('MAX_DURATION', 'The voice session reached its time limit. Start a new one to continue.');
    if (t / 1000 >= this.tokenExpiry) return this.close('UNAUTHENTICATED', 'Your session expired. Sign in again to continue.');
    if (t - this.lastActivity >= limits.idleMs) return this.close('IDLE', 'The voice session ended after a period of silence.');
    if (t - this.lastAuthCheck >= limits.authCheckMs) {
      this.lastAuthCheck = t;
      try {
        await authorizeDiagram(this.deps.ai.pool, this.userId!, this.diagramId!, 'view');
      } catch (error) {
        if (error instanceof AppError) this.close(error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND', 'Your access to this diagram changed.');
      }
    }
  }

  // ---------- output ----------

  private send(message: VoiceServerMessage): void {
    if (this.state === 'closed') return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      /* the socket is gone: onSocketClosed will follow */
    }
  }

  private sendResult(result: VoiceResult): void {
    this.send({ type: 'result', result });
  }

  private fail(error: unknown): void {
    this.deps.ai.log?.('voice session error', { session: this.id, name: error instanceof Error ? error.name : 'unknown' });
    this.close('INTERNAL', 'Something went wrong with the voice session.');
  }

  private leaveNew(): void {
    if (!this.newCounted) return;
    this.newCounted = false;
    this.deps.registry.unauthenticated -= 1;
  }

  private shutdown(reason: VoiceCloseReason, closeSocket: boolean): void {
    if (this.state === 'closed') return;
    this.leaveNew();
    const wasReady = this.state === 'ready';
    this.state = 'closed';
    clearTimeout(this.helloTimer);
    clearInterval(this.tickTimer);
    this.opening?.abort();
    this.live?.close();
    this.live = undefined;
    this.listening = false;
    this.queue.length = 0;
    if (this.userId && this.deps.registry.byUser.get(this.userId) === this) this.deps.registry.byUser.delete(this.userId);
    if (closeSocket) {
      try {
        this.socket.close(VOICE_CLOSE[reason], reason);
      } catch {
        /* already closed */
      }
    }
    if (wasReady) {
      this.deps.ai.log?.('voice session ended', { session: this.id, reason, durationMs: this.now() - this.startedAt, ...this.stats });
    }
  }
}
