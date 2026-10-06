import { describe, expect, it, vi } from 'vitest';
import { VOICE_CLOSE, type VoiceResult } from '../contracts';
import { MicrophoneError, type MicCapture } from './capture';
import { FRAME_SAMPLES, PcmEncoder } from './pcm';
import { VoiceClient, initialVoiceView, type SocketLike, type VoiceView } from './voiceClient';

class FakeSocket implements SocketLike {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent: Array<string | ArrayBufferLike | ArrayBufferView> = [];
  closedWith: number | undefined;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  send(data: string | ArrayBufferLike | ArrayBufferView) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  server(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  closeFromServer(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  texts = () => this.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s));
  frames = () => this.sent.filter((s) => typeof s !== 'string');
}

function setup(over: { token?: string | null; capture?: () => Promise<MicCapture> } = {}) {
  const socket = new FakeSocket();
  let onFrame: (f: Uint8Array) => void = () => undefined;
  const micStops = vi.fn();
  let view: VoiceView = { ...initialVoiceView };
  const results: Array<[VoiceResult, string]> = [];
  let versionListener: ((v: number) => void) | undefined;
  const unwatch = vi.fn();
  const diagram = { id: '11111111-1111-4111-8111-111111111111', version: 7 };
  const client = new VoiceClient({
    wsUrl: 'ws://localhost:8787/v1/voice',
    createSocket: (url) => ((socket as unknown as { url: string }).url = url, socket),
    capture: async (frame) => {
      if (over.capture) return over.capture();
      onFrame = frame;
      return { stop: micStops };
    },
    getToken: async () => (over.token === undefined ? 'token-token-token-token-token' : over.token),
    diagram: () => diagram,
    watchVersion: (l) => ((versionListener = l), unwatch),
    resync: async () => undefined,
    onResult: (r, id) => results.push([r, id]),
    update: (patch) => (view = { ...view, ...patch }),
    tokenRefreshMs: 1_000_000,
  });
  return { client, socket, micStops, unwatch, view: () => view, results, frame: (f: Uint8Array) => onFrame(f), version: (v: number) => versionListener?.(v), diagram };
}

const READY = { type: 'ready', sessionId: 's', maxSessionMs: 1000, audio: { format: 'pcm_s16le', sampleRate: 16000, channels: 1, maxChunkBytes: 16384 } };

async function listening(h: ReturnType<typeof setup>) {
  await h.client.start();
  h.socket.open();
  h.socket.server(READY);
  h.socket.server({ type: 'listening' });
}

describe('voice client', () => {
  it('connects without the token in the URL, says hello first, then starts, and only then streams audio', async () => {
    const h = setup();
    await h.client.start();
    expect((h.socket as unknown as { url: string }).url).toBe('ws://localhost:8787/v1/voice');
    h.frame(new Uint8Array(3200)); // too early: nothing is sent
    h.socket.open();
    expect(h.socket.texts()[0]).toEqual({ type: 'hello', token: 'token-token-token-token-token', diagramId: h.diagram.id, version: 7 });
    h.socket.server(READY);
    expect(h.socket.texts()[1]).toEqual({ type: 'start' });
    h.frame(new Uint8Array(3200)); // the model is not open yet
    expect(h.socket.frames()).toHaveLength(0);
    h.socket.server({ type: 'listening' });
    expect(h.view().status).toBe('listening');
    h.frame(new Uint8Array(3200));
    expect(h.socket.frames()).toHaveLength(1);
  });

  it('reports the diagram version as it changes, and sheds audio when the link is slow', async () => {
    const h = setup();
    await listening(h);
    h.version(9);
    expect(h.socket.texts().slice(-1)[0]).toEqual({ type: 'context', version: 9 });
    h.socket.bufferedAmount = 10_000_000;
    h.frame(new Uint8Array(3200));
    expect(h.socket.frames()).toHaveLength(0);
  });

  it('shows what is heard, what is being done, and hands results to the app', async () => {
    const h = setup();
    await listening(h);
    h.socket.server({ type: 'transcript', text: 'put redis between', final: false });
    expect(h.view().transcript).toBe('put redis between');
    h.socket.server({ type: 'proposal', operationId: 'op', kind: 'EDIT', request: 'Put Redis between Orders and PostgreSQL' });
    expect(h.view().working).toBe('Put Redis between Orders and PostgreSQL');
    const result: VoiceResult = { operationId: 'op', status: 'ERROR', kind: 'EDIT', error: { code: 'DIAGRAM_VERSION_CONFLICT', message: 'x' } };
    h.socket.server({ type: 'result', result });
    expect(h.view().working).toBeNull();
    expect(h.results).toEqual([[result, h.diagram.id]]);
  });

  it('ignores messages outside the contract', async () => {
    const h = setup();
    await listening(h);
    h.socket.server({ type: 'result', result: { rm: 'rf' } });
    h.socket.server({ type: 'something-new' });
    expect(h.results).toHaveLength(0);
    expect(h.view().status).toBe('listening');
  });

  it('stop releases the microphone at once, finishes pending work, then closes', async () => {
    const h = setup();
    await listening(h);
    h.socket.server({ type: 'proposal', operationId: 'op', kind: 'EDIT', request: 'add a cache' });
    h.client.stop();
    expect(h.micStops).toHaveBeenCalled();
    expect(h.view().status).toBe('idle');
    expect(h.socket.texts().slice(-1)[0]).toEqual({ type: 'stop' });
    expect(h.socket.closedWith).toBeUndefined(); // still waiting for the pending request
    h.socket.server({ type: 'result', result: { operationId: 'op', status: 'ERROR', kind: 'EDIT', error: { code: 'INVALID_REQUEST', message: 'x' } } });
    expect(h.socket.closedWith).toBe(1000);
    expect(h.unwatch).toHaveBeenCalled();
    expect(h.results).toHaveLength(1);
  });

  it('stop with nothing pending closes immediately', async () => {
    const h = setup();
    await listening(h);
    h.client.stop();
    expect(h.socket.closedWith).toBe(1000);
    expect(h.client.running).toBe(false);
  });

  it('a lost connection is explained, the microphone is released, and voice can be started again', async () => {
    const h = setup();
    await listening(h);
    h.socket.closeFromServer(1006);
    expect(h.view().status).toBe('error');
    expect(h.view().error).toMatch(/connection was lost/i);
    expect(h.micStops).toHaveBeenCalled();
    expect(h.client.running).toBe(false);
    await h.client.start(); // the user presses the microphone again
    expect(h.view().status).toBe('connecting');
  });

  it.each([
    [VOICE_CLOSE.UNAUTHENTICATED, 'error', /sign in again/i],
    [VOICE_CLOSE.NOT_FOUND, 'error', /no longer have access/i],
    [VOICE_CLOSE.REPLACED, 'idle', /another tab/i],
    [VOICE_CLOSE.MAX_DURATION, 'idle', /time limit/i],
    [VOICE_CLOSE.IDLE, 'idle', /silence/i],
  ])('close code %i is explained in plain words', async (code, status, text) => {
    const h = setup();
    await listening(h);
    h.socket.closeFromServer(code);
    expect(h.view().status).toBe(status);
    expect(h.view().error ?? h.view().info).toMatch(text);
  });

  it('a non-fatal model error stops listening but keeps pending results coming', async () => {
    const h = setup();
    await listening(h);
    h.socket.server({ type: 'proposal', operationId: 'op', kind: 'EDIT', request: 'add a cache' });
    h.socket.server({ type: 'error', code: 'AI_UNAVAILABLE', message: 'The voice connection to the model ended.', fatal: false });
    expect(h.view()).toMatchObject({ status: 'error', error: 'The voice connection to the model ended.' });
    h.frame(new Uint8Array(3200));
    expect(h.socket.frames()).toHaveLength(0);
    expect(h.socket.closedWith).toBeUndefined();
  });

  it('microphone refusal is reported without opening any connection', async () => {
    const h = setup({ capture: async () => { throw new MicrophoneError('denied', 'Microphone access was blocked.'); } });
    await h.client.start();
    expect(h.view()).toMatchObject({ status: 'error', error: 'Microphone access was blocked.' });
    expect(h.socket.sent).toHaveLength(0);
    expect(h.client.running).toBe(false);
  });

  it('without a sign-in token nothing is opened', async () => {
    const h = setup({ token: null });
    await h.client.start();
    expect(h.view().status).toBe('error');
    expect(h.socket.sent).toHaveLength(0);
  });

  it('dispose (sign-out, another diagram) releases everything and resets the view', async () => {
    const h = setup();
    await listening(h);
    h.client.dispose();
    expect(h.micStops).toHaveBeenCalled();
    expect(h.socket.closedWith).toBe(1000);
    expect(h.view()).toEqual(initialVoiceView);
  });
});

describe('PCM encoder', () => {
  it('converts 48 kHz float audio to 16 kHz little-endian Int16 frames of 100 ms', () => {
    const frames: Uint8Array[] = [];
    const encoder = new PcmEncoder(48_000, (f) => frames.push(f));
    const block = new Float32Array(128).fill(0.5);
    for (let i = 0; i < 400; i++) encoder.push(block); // 51200 samples = 1.07 s
    expect(frames.length).toBe(10);
    expect(frames[0]!.byteLength).toBe(FRAME_SAMPLES * 2);
    expect(new Int16Array(frames[0]!.buffer)[10]).toBe(Math.round(0.5 * 0x7fff));
  });

  it('clamps loud input and keeps negative values', () => {
    const frames: Uint8Array[] = [];
    const encoder = new PcmEncoder(16_000, (f) => frames.push(f));
    encoder.push(new Float32Array(FRAME_SAMPLES + 2).map((_, i) => (i % 2 ? -3 : 3)));
    const samples = new Int16Array(frames[0]!.buffer);
    expect(samples[0]).toBe(0x7fff);
    expect(samples[1]).toBe(-0x8000);
  });
});
