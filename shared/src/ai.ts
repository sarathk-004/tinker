import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { graphSchema, uuidSchema } from './graph.ts';
import { presentationSchema } from './presentation.ts';
import { versionSchema } from './commands.ts';

/** UTF-8 byte length without needing TextEncoder types in this DOM-less package. */
function utf8Bytes(text: string): number {
  return encodeURIComponent(text).replace(/%[A-F\d]{2}/g, 'U').length;
}

/** POST /v1/diagrams/{id}/ai/command (LLD section 10). The text is the user's original words; never provider output. */
export const aiCommandRequestSchema = z.strictObject({
  expectedVersion: versionSchema,
  conversationId: uuidSchema.optional(),
  input: z.strictObject({
    type: z.literal('TEXT'),
    text: z
      .string()
      .trim()
      .min(1)
      .refine((t) => utf8Bytes(t) <= LIMITS.maxCommandTextBytes, { message: `text exceeds ${LIMITS.maxCommandTextBytes} bytes` }),
  }),
});
export type AiCommandRequest = z.infer<typeof aiCommandRequestSchema>;

export const chatMessageSchema = z.strictObject({
  id: uuidSchema,
  role: z.enum(['USER', 'ASSISTANT']),
  content: z.string(),
  createdAt: z.iso.datetime(),
  metadata: z.record(z.string(), z.json()).optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Where the interpretation came from: the deterministic parser (no model call) or the provider gateway. */
export const aiSourceSchema = z.enum(['PARSER', 'AI']);

const commandSummarySchema = z.strictObject({ type: z.string(), summary: z.string() });

/** The command(s) were validated and committed atomically as ONE new diagram version. */
export const aiAppliedResponseSchema = z.strictObject({
  status: z.literal('APPLIED'),
  source: aiSourceSchema,
  interpretation: z.strictObject({ commands: z.array(commandSummarySchema).min(1) }),
  conversationId: uuidSchema,
  messages: z.array(chatMessageSchema),
  diagram: z.strictObject({ id: uuidSchema, version: versionSchema, graph: graphSchema, presentation: presentationSchema }),
  replayed: z.boolean().optional(),
});

/** Nothing was changed: the request was ambiguous or referred to something unknown, so the user is asked instead of guessed at. */
export const aiClarificationResponseSchema = z.strictObject({
  status: z.literal('CLARIFICATION'),
  source: aiSourceSchema,
  question: z.string(),
  options: z.array(z.string()).max(6),
  conversationId: uuidSchema,
  messages: z.array(chatMessageSchema),
  diagram: z.strictObject({ id: uuidSchema, version: versionSchema }),
  replayed: z.boolean().optional(),
});

export const aiCommandResponseSchema = z.discriminatedUnion('status', [aiAppliedResponseSchema, aiClarificationResponseSchema]);
export type AiCommandResponse = z.infer<typeof aiCommandResponseSchema>;
export type AiAppliedResponse = z.infer<typeof aiAppliedResponseSchema>;

/** GET /v1/diagrams/{id}/conversation: the caller's most recent conversation for this diagram (oldest first, capped). */
export const conversationResponseSchema = z.strictObject({
  conversationId: uuidSchema.nullable(),
  messages: z.array(chatMessageSchema),
});
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;

/** GET /v1/diagrams/{id}/conversations: the caller's earlier chats about this diagram, newest first. The title is the first thing they said. */
export const conversationSummarySchema = z.strictObject({
  id: uuidSchema,
  title: z.string(),
  updatedAt: z.iso.datetime(),
  messageCount: z.number().int().min(0),
});
export const conversationListResponseSchema = z.strictObject({ conversations: z.array(conversationSummarySchema) });
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

/** POST /v1/diagrams/{id}/ai/ask (LLD section 10): read-only advice. Never changes the diagram. */
export const aiAskRequestSchema = z.strictObject({
  conversationId: uuidSchema.optional(),
  question: z
    .string()
    .trim()
    .min(1)
    .refine((t) => utf8Bytes(t) <= LIMITS.maxCommandTextBytes, { message: `question exceeds ${LIMITS.maxCommandTextBytes} bytes` }),
});
export type AiAskRequest = z.infer<typeof aiAskRequestSchema>;

/**
 * `ANALYZER` = the answer was written by the deterministic graph analyzer because the model was unavailable;
 * the facts are the same either way. Every id below refers to a component in the diagram at `diagram.version`.
 */
export const aiAskResponseSchema = z.strictObject({
  answer: z.string(),
  source: z.enum(['AI', 'ANALYZER']),
  analysis: z.strictObject({
    /** Components the question is about (found by name in the question). */
    focusNodeIds: z.array(uuidSchema),
    /** Components that receive from the focus, directly or through others. */
    downstreamNodeIds: z.array(uuidSchema),
    /** Components that send to the focus, directly or through others. */
    upstreamNodeIds: z.array(uuidSchema),
    /** What the UI should highlight (transient, never stored in the diagram). */
    affectedNodeIds: z.array(uuidSchema),
    /** Groups of components that form a loop. */
    cycles: z.array(z.array(uuidSchema)),
  }),
  conversationId: uuidSchema,
  messages: z.array(chatMessageSchema),
  diagram: z.strictObject({ id: uuidSchema, version: versionSchema }),
});
export type AiAskResponse = z.infer<typeof aiAskResponseSchema>;
