import { z } from 'zod';
import { NODE_KINDS, diagramCommandSchema, nodeKindSchema, type DiagramCommand, type NodeKind } from '@tinker/shared';
import { applyCommand, type DiagramDoc, type DomainError } from '../../diagrams/domain/index.ts';

/**
 * A plan is a short list of steps in ALIAS terms (n1, e2, new1): the model never sees or invents UUIDs.
 * Steps are untrusted: they are schema-validated, aliases are resolved against the actual document, and every step then runs
 * through the same diagram engine as manual edits. A plan commits atomically (all steps or nothing).
 */
export const MAX_PLAN_STEPS = 8;
export const STEP_TYPES = ['ADD_NODE', 'REMOVE_NODE', 'RENAME_NODE', 'UPDATE_NODE', 'CONNECT', 'DISCONNECT', 'INSERT_BETWEEN'] as const;

const alias = z.string().trim().min(1).max(40);
const text = (max: number) => z.string().trim().min(1).max(max);

export const planStepSchema = z.strictObject({
  type: z.enum(STEP_TYPES),
  /** Alias given to a node CREATED by this step so later steps can refer to it. */
  as: alias.optional(),
  ref: alias.optional(),
  name: text(120).optional(),
  kind: nodeKindSchema.optional(),
  technology: text(120).nullable().optional(),
  source: alias.optional(),
  target: alias.optional(),
  edge: alias.optional(),
  relationship: text(120).optional(),
});
export type PlanStep = z.infer<typeof planStepSchema>;

/** Aliases for the current document: n1.. for nodes and e1.. for edges, in document order (stable for a given version). */
export interface AliasMap {
  nodeToAlias: Map<string, string>;
  aliasToNode: Map<string, string>;
  aliasToEdge: Map<string, string>;
  edgeToAlias: Map<string, string>;
}

export function buildAliases(doc: DiagramDoc): AliasMap {
  const map: AliasMap = { nodeToAlias: new Map(), aliasToNode: new Map(), aliasToEdge: new Map(), edgeToAlias: new Map() };
  doc.graph.nodes.forEach((n, i) => {
    map.nodeToAlias.set(n.id, `n${i + 1}`);
    map.aliasToNode.set(`n${i + 1}`, n.id);
  });
  doc.graph.edges.forEach((e, i) => {
    map.edgeToAlias.set(e.id, `e${i + 1}`);
    map.aliasToEdge.set(`e${i + 1}`, e.id);
  });
  return map;
}

/** Rough kind inference for new nodes when the request did not say (the old prototype inferred icons/types from names). */
export function inferNodeKind(name: string): { kind: NodeKind; technology?: string } {
  const n = name.toLowerCase();
  const has = (...words: string[]) => words.some((w) => n.includes(w));
  if (has('redis', 'memcache', 'elasticache') || /\bcache\b/.test(n)) return { kind: 'CACHE', technology: has('redis') ? 'Redis' : has('memcache') ? 'Memcached' : 'ElastiCache' };
  if (has('postgres')) return { kind: 'DATABASE', technology: 'PostgreSQL' };
  if (has('mysql')) return { kind: 'DATABASE', technology: 'MySQL' };
  if (has('dynamo')) return { kind: 'DATABASE', technology: 'DynamoDB' };
  if (has('mongo')) return { kind: 'DATABASE', technology: 'MongoDB' };
  if (has('opensearch', 'elasticsearch')) return { kind: 'DATABASE', technology: 'OpenSearch' };
  if (has('database', 'rds') || /\bdb\b/.test(n)) return { kind: 'DATABASE' };
  if (has('sqs')) return { kind: 'QUEUE', technology: 'Amazon SQS' };
  if (has('sns')) return { kind: 'QUEUE', technology: 'Amazon SNS' };
  if (has('kafka')) return { kind: 'QUEUE', technology: 'Kafka' };
  if (has('kinesis')) return { kind: 'QUEUE', technology: 'Amazon Kinesis' };
  if (has('eventbridge', 'event bus', 'queue', 'stream')) return { kind: 'QUEUE' };
  if (has('s3', 'bucket', 'object storage', 'blob') || /\bstorage\b/.test(n)) return { kind: 'STORAGE', technology: has('s3', 'bucket') ? 'Amazon S3' : undefined } as { kind: NodeKind; technology?: string };
  if (has('gateway', 'load balancer', 'balancer', 'cloudfront', 'cdn', 'route53', 'route 53', 'waf', 'firewall', 'proxy', 'nginx') || /\balb\b|\belb\b/.test(n)) return { kind: 'GATEWAY' };
  if (has('client', 'browser', 'mobile', 'web app', 'frontend', 'front-end') || /\buser\b/.test(n)) return { kind: 'CLIENT' };
  return { kind: 'SERVICE' };
}

export interface CommandSummary {
  type: string;
  summary: string;
}

export type PlanOutcome =
  | { ok: true; doc: DiagramDoc; commands: DiagramCommand[]; summaries: CommandSummary[] }
  /** A reference could not be resolved or a step is incomplete: ask the user, never guess. */
  | { ok: false; kind: 'CLARIFY'; question: string; options: string[] }
  /** The engine refused a step (domain rule). Nothing was applied. */
  | { ok: false; kind: 'REFUSED'; error: DomainError; stepIndex: number };

const nameOf = (doc: DiagramDoc, id: string) => doc.graph.nodes.find((n) => n.id === id)?.name ?? 'component';

/**
 * Resolve aliases and run every step through the diagram engine, in order, on an in-memory copy. Pure and deterministic
 * (ids come from `newId`), so it is run once as a dry run before any commit and again inside the commit transaction.
 */
export function executePlan(start: DiagramDoc, steps: readonly PlanStep[], aliases: AliasMap, newId: () => string): PlanOutcome {
  let doc = start;
  const created = new Map<string, string>(); // alias of a node created in this plan -> its real id
  const commands: DiagramCommand[] = [];
  const summaries: CommandSummary[] = [];

  const clarify = (question: string, options: string[] = []): PlanOutcome => ({ ok: false, kind: 'CLARIFY', question, options });
  const known = () => [...aliases.nodeToAlias.keys()].map((id) => nameOf(start, id)).slice(0, 4);

  const node = (a: string | undefined, role: string): { id: string } | PlanOutcome => {
    if (!a) return clarify(`I need to know which component to use as the ${role}. Which one do you mean?`, known());
    const id = created.get(a) ?? aliases.aliasToNode.get(a);
    if (!id || !doc.graph.nodes.some((n) => n.id === id)) return clarify(`I couldn't match the ${role} to a component in this diagram. Which one do you mean?`, known());
    return { id };
  };
  const isOutcome = (v: { id: string } | PlanOutcome): v is PlanOutcome => 'ok' in v;

  for (const [index, step] of steps.entries()) {
    let command: DiagramCommand;
    let producesNode = false;
    let describe: (next: DiagramDoc) => string;

    switch (step.type) {
      case 'ADD_NODE': {
        if (!step.name) return clarify('What should the new component be called?');
        const inferred = inferNodeKind(step.name);
        const technology = step.technology === null ? undefined : (step.technology ?? inferred.technology);
        command = { type: 'ADD_NODE', node: { name: step.name, kind: step.kind ?? inferred.kind, ...(technology ? { technology } : {}), metadata: {} } };
        producesNode = true;
        describe = () => `Added ${step.name}`;
        break;
      }
      case 'REMOVE_NODE': {
        const n = node(step.ref, 'component to remove');
        if (isOutcome(n)) return n;
        const label = nameOf(doc, n.id);
        command = { type: 'REMOVE_NODE', nodeId: n.id };
        describe = () => `Removed ${label}`;
        break;
      }
      case 'RENAME_NODE': {
        const n = node(step.ref, 'component to rename');
        if (isOutcome(n)) return n;
        if (!step.name) return clarify('What should it be renamed to?');
        const before = nameOf(doc, n.id);
        command = { type: 'RENAME_NODE', nodeId: n.id, name: step.name };
        describe = () => `Renamed ${before} to ${step.name}`;
        break;
      }
      case 'UPDATE_NODE': {
        const n = node(step.ref, 'component to update');
        if (isOutcome(n)) return n;
        const updates: { kind?: NodeKind; technology?: string | null } = {};
        if (step.kind) updates.kind = step.kind;
        if (step.technology !== undefined) updates.technology = step.technology;
        if (Object.keys(updates).length === 0) return clarify('What should be changed about it?');
        const label = nameOf(doc, n.id);
        command = { type: 'UPDATE_NODE', nodeId: n.id, updates };
        describe = () => `Updated ${label}`;
        break;
      }
      case 'CONNECT': {
        const s = node(step.source, 'source');
        if (isOutcome(s)) return s;
        const t = node(step.target, 'target');
        if (isOutcome(t)) return t;
        const [from, to] = [nameOf(doc, s.id), nameOf(doc, t.id)];
        command = { type: 'CONNECT', sourceNodeId: s.id, targetNodeId: t.id, ...(step.relationship ? { relationship: step.relationship } : {}) };
        describe = () => `Connected ${from} to ${to}`;
        break;
      }
      case 'DISCONNECT': {
        if (step.edge) {
          const edgeId = aliases.aliasToEdge.get(step.edge);
          if (!edgeId) return clarify("I couldn't match that connection. Which one do you mean?");
          const e = doc.graph.edges.find((x) => x.id === edgeId);
          const label = e ? `${nameOf(doc, e.sourceNodeId)} to ${nameOf(doc, e.targetNodeId)}` : 'the connection';
          command = { type: 'DISCONNECT', edgeId };
          describe = () => `Disconnected ${label}`;
        } else {
          const s = node(step.source, 'source');
          if (isOutcome(s)) return s;
          const t = node(step.target, 'target');
          if (isOutcome(t)) return t;
          const [from, to] = [nameOf(doc, s.id), nameOf(doc, t.id)];
          command = { type: 'DISCONNECT', sourceNodeId: s.id, targetNodeId: t.id };
          describe = () => `Disconnected ${from} from ${to}`;
        }
        break;
      }
      case 'INSERT_BETWEEN': {
        const s = node(step.source, 'source');
        if (isOutcome(s)) return s;
        const t = node(step.target, 'target');
        if (isOutcome(t)) return t;
        if (!step.name) return clarify('What should the new component be called?');
        const inferred = inferNodeKind(step.name);
        const technology = step.technology === null ? undefined : (step.technology ?? inferred.technology);
        const edgeId = step.edge ? aliases.aliasToEdge.get(step.edge) : undefined;
        if (step.edge && !edgeId) return clarify("I couldn't match that connection. Which one do you mean?");
        const [from, to] = [nameOf(doc, s.id), nameOf(doc, t.id)];
        command = {
          type: 'INSERT_BETWEEN',
          sourceNodeId: s.id,
          targetNodeId: t.id,
          ...(edgeId ? { edgeId } : {}),
          node: { name: step.name, kind: step.kind ?? inferred.kind, ...(technology ? { technology } : {}), metadata: {} },
        };
        producesNode = true;
        describe = () => `Inserted ${step.name} between ${from} and ${to}`;
        break;
      }
    }

    // Defence in depth: whatever resolved above must still be a valid contract command.
    const valid = diagramCommandSchema.safeParse(command);
    if (!valid.success) return clarify('That request produced an invalid change. Could you rephrase it?');

    // The first id the engine draws for a node-creating command is the new node's id; remember it under the step's alias.
    let firstId: string | undefined;
    const recording = () => {
      const id = newId();
      firstId ??= id;
      return id;
    };
    const result = applyCommand(doc, valid.data, recording);
    if (!result.ok) return { ok: false, kind: 'REFUSED', error: result.error, stepIndex: index };
    if (producesNode && step.as && firstId) created.set(step.as, firstId);

    doc = result.value;
    commands.push(valid.data);
    summaries.push({ type: valid.data.type, summary: describe(doc) });
  }

  return { ok: true, doc, commands, summaries };
}

export { NODE_KINDS };
