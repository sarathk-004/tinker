import { VOICE_CLOSE, voiceServerMessageSchema, type VoiceResult } from '../contracts';
import type { CaptureFactory, MicCapture } from './capture';
import { MicrophoneError } from './capture';

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'error';

export interface VoiceView {
  status: VoiceStatus;
  /** What the user is saying right now (provisional until the turn ends). */
  transcript: string;
  /** The request being carried out ("Put Redis between Orders and PostgreSQL"). */
  working: string | null;
  error: string | null;
  info: string | null;
}

export const initialVoiceView: VoiceView = { status: 'idle', transcript: '', working: null, error: null, info: null };

/** The subset of WebSocket the client uses (injectable for tests). */
export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface VoiceDeps {
  wsUrl: string;
  createSocket(url: string): SocketLike;
  capture: CaptureFactory;
  getToken(): Promise<string | null>;
  diagram(): { id: string; version: number } | null;
  /** Called whenever the version on screen changes; returns an unsubscribe function. */
  watchVersion(listener: (version: number) => void): () => void;
  /** Bring the screen up to date with the server before a session starts (also how a lost connection is reconciled). */
  resync(): Promise<void>;
  onResult(result: VoiceResult, diagramId: string): void;
  update(patch: Partial<VoiceView>): void;
  tokenRefreshMs?: number;
}

const OPEN = 1;
const MAX_BUFFERED = 256 * 1024;
const FINISH_GRACE_MS = 20_000;

const closeMessage = (code: number): { status: VoiceStatus; text: string } => {
  switch (code) {
    case VOICE_CLOSE.UNAUTHENTICATED:
      return { status: 'error', text: 'Your sign-in expired. Please sign in again to use voice.' };
    case VOICE_CLOSE.FORBIDDEN:
    case VOICE_CLOSE.NOT_FOUND:
      return { status: 'error', text: 'You no longer have access to this diagram.' };
    case VOICE_CLOSE.REPLACED:
      return { status: 'idle', text: 'Voice was started in another tab, so this one stopped.' };
    case VOICE_CLOSE.MAX_DURATION:
      return { status: 'idle', text: 'The voice session reached its time limit. Press the microphone to continue.' };
    case VOICE_CLOSE.IDLE:
      return { status: 'idle', text: 'Voice stopped after a period of silence.' };
    case VOICE_CLOSE.QUOTA:
      return { status: 'error', text: 'Voice is busy right now. Please try again in a moment.' };
    case VOICE_CLOSE.UNAVAILABLE:
      return { status: 'error', text: 'Voice is not available right now. Typing still works.' };
    default:
      return { status: 'error', text: 'The voice connection was lost. Press the microphone to try again. Typing and editing still work.' };
  }
};

/**
 * Browser side of a voice session (wire contract: shared/src/voice.ts). It never decides what an utterance means: it streams
 * audio and shows what the server reports. Voice is an extra input: whatever happens here, manual editing is untouched.
 */
export class VoiceClient {
  private socket: SocketLike | undefined;
  private mic: MicCapture | undefined;
  private active = false; // a session is being set up or running
  private audioOpen = false;
  /** True while a reply is being spoken: the microphone is not streamed so the assistant cannot hear itself. */
  private paused = false;
  private pendingOps = 0;
  private lastToken: string | null = null;
  private diagramId: string | undefined;
  private unwatch: (() => void) | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(private readonly deps: VoiceDeps) {}

  get running(): boolean {
    return this.active;
  }

  async toggle(): Promise<void> {
    if (this.active) this.stop();
    else await this.start();
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;
    const { update } = this.deps;
    update({ status: 'connecting', transcript: '', working: null, error: null, info: null });
    try {
      const target = this.deps.diagram();
      if (!target) throw new Error('Open a diagram first.');
      await this.deps.resync().catch(() => undefined);
      if (generation !== this.generation) return;
      const token = await this.deps.getToken();
      if (generation !== this.generation) return;
      if (!token) throw new Error('Please sign in again.');
      // The microphone permission prompt needs the click that started this; ask before opening the connection.
      const mic = await this.deps.capture((frame) => this.sendFrame(frame));
      if (generation !== this.generation) return mic.stop();
      this.mic = mic;
      this.diagramId = target.id;
      this.lastToken = token;
      const socket = this.deps.createSocket(this.deps.wsUrl);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      const fresh = this.deps.diagram() ?? target;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token, diagramId: target.id, version: fresh.version }));
      socket.onmessage = (event) => this.onMessage(event.data, generation);
      socket.onclose = (event) => this.onClosed(event.code, generation);
      socket.onerror = () => undefined; // a close event always follows
      this.unwatch = this.deps.watchVersion((version) => this.send({ type: 'context', version }));
      this.refreshTimer = setInterval(() => void this.refreshToken(), this.deps.tokenRefreshMs ?? 4 * 60_000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.teardown();
      update({ status: 'error', error: error instanceof MicrophoneError || error instanceof Error ? error.message : 'Could not start voice.' });
    }
  }

  /** Hold the microphone back while a spoken reply plays (and release it afterwards). */
  pauseAudio(paused: boolean): void {
    this.paused = paused;
  }

  /** The user stopped. Pending requests are allowed to finish; then the connection is released. */
  stop(): void {
    if (!this.active) return;
    this.audioOpen = false;
    this.mic?.stop();
    this.mic = undefined;
    this.deps.update({ status: 'idle', transcript: '' });
    this.send({ type: 'stop' });
    if (this.pendingOps === 0 && this.socket) return this.teardown();
    if (!this.socket) return this.teardown();
    this.finishTimer = setTimeout(() => this.teardown(), FINISH_GRACE_MS);
  }

  /** Immediate release (sign-out, diagram switch). */
  dispose(): void {
    this.teardown();
    this.deps.update({ ...initialVoiceView });
  }

  // ---------- internals ----------

  private send(message: unknown): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private sendFrame(frame: Uint8Array): void {
    if (!this.audioOpen || this.paused || this.socket?.readyState !== OPEN) return;
    if (this.socket.bufferedAmount > MAX_BUFFERED) return; // a slow link: drop audio rather than lag behind
    this.socket.send(frame);
  }

  private async refreshToken(): Promise<void> {
    const token = await this.deps.getToken().catch(() => null);
    if (token && token !== this.lastToken) {
      this.lastToken = token;
      this.send({ type: 'auth', token });
    }
  }

  private onMessage(raw: unknown, generation: number): void {
    if (generation !== this.generation || typeof raw !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = voiceServerMessageSchema.safeParse(json);
    if (!parsed.success) return; // outside the contract: ignore
    const message = parsed.data;
    const { update } = this.deps;
    switch (message.type) {
      case 'ready':
        this.send({ type: 'start' });
        break;
      case 'listening':
        this.audioOpen = true;
        update({ status: 'listening', error: null });
        break;
      case 'transcript':
        update({ transcript: message.text });
        break;
      case 'proposal':
        this.pendingOps += 1;
        update({ working: message.request, transcript: '' });
        break;
      case 'result':
        this.pendingOps = Math.max(0, this.pendingOps - 1);
        update({ working: null });
        if (this.diagramId) this.deps.onResult(message.result, this.diagramId);
        if (!this.audioOpen && this.pendingOps === 0 && this.active) this.teardown();
        break;
      case 'error':
        if (message.fatal) update({ error: message.message });
        else {
          // e.g. the model connection dropped: the session stays, but nothing is being heard.
          this.audioOpen = false;
          update({ status: 'error', error: message.message });
          if (this.pendingOps === 0) this.teardown();
          else this.mic?.stop();
        }
        break;
      case 'closing':
      case 'pong':
        break;
    }
  }

  private onClosed(code: number, generation: number): void {
    if (generation !== this.generation) return;
    const wasActive = this.active;
    const view = closeMessage(code);
    this.teardown();
    if (!wasActive) return;
    if (code === VOICE_CLOSE.NORMAL) this.deps.update({ status: 'idle' });
    else this.deps.update({ status: view.status, ...(view.status === 'error' ? { error: view.text, info: null } : { info: view.text, error: null }) });
  }

  private teardown(): void {
    this.generation += 1; // anything still in flight for the old session (an open microphone prompt, a late message) is ignored
    this.active = false;
    this.audioOpen = false;
    this.paused = false;
    this.pendingOps = 0;
    clearInterval(this.refreshTimer);
    clearTimeout(this.finishTimer);
    this.unwatch?.();
    this.unwatch = undefined;
    this.mic?.stop();
    this.mic = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      try {
        socket.close(1000);
      } catch {
        /* already closed */
      }
    }
  }
}
