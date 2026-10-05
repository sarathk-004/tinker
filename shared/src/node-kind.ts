import { z } from 'zod';

/** Complete NodeKind set (decision D06). `EXTERNAL` exists in the prototype's types but not its Gemini tool enum. */
export const NODE_KINDS = [
  'CLIENT',
  'GATEWAY',
  'SERVICE',
  'DATABASE',
  'CACHE',
  'QUEUE',
  'STORAGE',
  'EXTERNAL',
  'GENERIC',
] as const;

export const nodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof nodeKindSchema>;

/** Prototype `SystemNodeType` (lowercase) to NodeKind, for the I4 frontend mapping. */
export const NODE_KIND_FROM_LEGACY: Readonly<Record<string, NodeKind>> = {
  client: 'CLIENT',
  gateway: 'GATEWAY',
  service: 'SERVICE',
  database: 'DATABASE',
  cache: 'CACHE',
  queue: 'QUEUE',
  storage: 'STORAGE',
  external: 'EXTERNAL',
  generic: 'GENERIC',
};
