import { z } from 'zod';
import { aiAskResponseSchema, aiCommandResponseSchema } from './ai.ts';
import { errorCodeSchema } from './errors.ts';
import { uuidSchema } from './graph.ts';
import { versionSchema } from './commands.ts';

/**
 * Voice wire contract (decision D08). One WebSocket per voice session: GET /v1/voice, upgraded to WebSocket.
 *
 *  - Text frames carry JSON messages defined below. Binary frames carry audio (client -> server only).
 *  - The access token is NEVER in the URL: the first message must be `hello` and arrive within HELLO_TIMEOUT_MS.
 *  - The browser's Origin header must be one of the API's allowed origins.
 *  - Audio: raw 16-bit little-endian PCM, 16 kHz, mono (what the model expects).
 *  - Partial transcripts are provisional display only. Only a `proposal` (the model's explicit, finalized tool call) can lead to an
 *    edit, and it travels through the same service as typed commands (`/ai/command`, `/ai/ask`), bound to the diagram version the
 *    client last reported with `context`.
 *  - `operationId` is stable for one proposal. A repeated tool call with the same id is applied once.
 */
export const VOICE_PATH = '/v1/voice';

export const VOICE_AUDIO = { format: 'pcm_s16le', sampleRate: 16_000, channels: 1, maxChunkBytes: 16_384 } as const;

export const VOICE_LIMITS = {
  helloTimeoutMs: 5_000,
  maxSessionMs: 10 * 60_000,
  idleMs: 45_000,
  /** Sustained audio the server accepts (real time is 32 KB/s; this leaves headroom for bursts). */
  maxAudioBytesPerSecond: 64_000,
  maxTextFrameBytes: 4_096,
  maxPendingProposals: 3,
} as const;

/** WebSocket close codes (4000-4999 are application defined). */
export const VOICE_CLOSE = {
  NORMAL: 1000,
  BAD_PROTOCOL: 4400,
  UNAUTHENTICATED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  REPLACED: 4409,
  MAX_DURATION: 4410,
  IDLE: 4411,
  QUOTA: 4429,
  INTERNAL: 4500,
  UNAVAILABLE: 4503,
} as const;
export type VoiceCloseReason = keyof typeof VOICE_CLOSE;

// ---- client -> server ----

const token = z.string().min(20).max(8_192);

export const voiceClientMessageSchema = z.discriminatedUnion('type', [
  /** First message. `version` is the diagram version the client has on screen. */
  z.strictObject({ type: z.literal('hello'), token, diagramId: uuidSchema, version: versionSchema }),
  /** Refresh credentials before the old token expires. */
  z.strictObject({ type: z.literal('auth'), token }),
  /** The diagram version the client now has. Sent whenever it changes; proposals are bound to the latest one. */
  z.strictObject({ type: z.literal('context'), version: versionSchema }),
  /** Open the model session and start accepting audio frames. */
  z.strictObject({ type: z.literal('start') }),
  /** The user stopped speaking for good: finish pending proposals, then close the model session. */
  z.strictObject({ type: z.literal('stop') }),
  /** Drop proposals that have not started executing. */
  z.strictObject({ type: z.literal('cancel') }),
  z.strictObject({ type: z.literal('ping') }),
]);
export type VoiceClientMessage = z.infer<typeof voiceClientMessageSchema>;

// ---- server -> client ----

export const voiceResultSchema = z.union([
  z.strictObject({ operationId: z.string(), status: z.literal('OK'), kind: z.literal('EDIT'), response: aiCommandResponseSchema }),
  z.strictObject({ operationId: z.string(), status: z.literal('OK'), kind: z.literal('ASK'), response: aiAskResponseSchema }),
  z.strictObject({ operationId: z.string(), status: z.literal('ERROR'), kind: z.enum(['EDIT', 'ASK']), error: z.strictObject({ code: errorCodeSchema, message: z.string() }) }),
]);
export type VoiceResult = z.infer<typeof voiceResultSchema>;

export const voiceServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ready'),
    sessionId: z.string(),
    maxSessionMs: z.number().int(),
    audio: z.strictObject({ format: z.literal(VOICE_AUDIO.format), sampleRate: z.literal(VOICE_AUDIO.sampleRate), channels: z.literal(VOICE_AUDIO.channels), maxChunkBytes: z.number().int() }),
  }),
  /** The model session is open: audio is being listened to. */
  z.strictObject({ type: z.literal('listening') }),
  /** What the user said. `final: false` is provisional and may change. */
  z.strictObject({ type: z.literal('transcript'), text: z.string(), final: z.boolean() }),
  /** The model's finalized request, about to run. `request` is text exactly like a typed command. */
  z.strictObject({ type: z.literal('proposal'), operationId: z.string(), kind: z.enum(['EDIT', 'ASK']), request: z.string() }),
  z.strictObject({ type: z.literal('result'), result: voiceResultSchema }),
  /** Not fatal unless `fatal`; a fatal error is followed by a close. */
  z.strictObject({ type: z.literal('error'), code: errorCodeSchema, message: z.string(), fatal: z.boolean() }),
  /** Sent just before the server closes the connection. */
  z.strictObject({ type: z.literal('closing'), reason: z.enum(Object.keys(VOICE_CLOSE) as [VoiceCloseReason, ...VoiceCloseReason[]]) }),
  z.strictObject({ type: z.literal('pong') }),
]);
export type VoiceServerMessage = z.infer<typeof voiceServerMessageSchema>;
