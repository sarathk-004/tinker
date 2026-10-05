import type { DiagramDoc } from '../../diagrams/domain/index.ts';
import { buildAliases, type AliasMap, type PlanStep } from '../domain/plan.ts';

/**
 * Deterministic parser: the fast path for plain commands ("put Redis between Orders and PostgreSQL"). It never calls a model.
 * Rules: a reference must resolve to exactly ONE component (exact name, else an unambiguous partial name, else a UUID).
 * Anything unknown or ambiguous becomes a clarification question; anything it does not recognise returns `none` so the
 * model gets a chance. Typed RESET is deliberately never executed (destructive and not yet undoable).
 */
export type ParseResult =
  | { kind: 'steps'; steps: PlanStep[] }
  | { kind: 'clarify'; question: string; options: string[] }
  | { kind: 'none' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`"'’]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

const stripSuffix = (s: string) => s.replace(/\s+(?:node|service|component|box|block|layer)$/i, '').trim();

type Resolved = { ok: true; alias: string; name: string } | { ok: false; result: Extract<ParseResult, { kind: 'clarify' }> };

function closeNames(doc: DiagramDoc, raw: string): string[] {
  const q = norm(raw);
  const tokens = new Set(q.split(' ').filter((t) => t.length > 2));
  return doc.graph.nodes
    .map((n) => {
      const name = norm(n.name);
      const overlap = name.split(' ').filter((t) => tokens.has(t)).length;
      const near = name.includes(q) || q.includes(name) ? 2 : 0;
      return { name: n.name, score: overlap + near };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.name)
    .slice(0, 4);
}

function resolveRef(doc: DiagramDoc, aliases: AliasMap, rawIn: string): Resolved {
  const raw = stripSuffix(rawIn.trim().replace(/[.!?]+$/, ''));
  const byId = UUID.test(raw) ? doc.graph.nodes.find((n) => n.id.toLowerCase() === raw.toLowerCase()) : undefined;
  const found = (id: string, name: string): Resolved => ({ ok: true, alias: aliases.nodeToAlias.get(id)!, name });
  if (byId) return found(byId.id, byId.name);

  const q = norm(raw);
  const exact = doc.graph.nodes.filter((n) => norm(n.name) === q);
  if (exact.length === 1) return found(exact[0]!.id, exact[0]!.name);
  const candidates =
    exact.length > 1
      ? exact
      : doc.graph.nodes.filter((n) => {
          const name = norm(n.name);
          return q.length >= 3 && name.length >= 3 && (name.includes(q) || q.includes(name));
        });
  if (candidates.length === 1) return found(candidates[0]!.id, candidates[0]!.name);
  if (candidates.length > 1) {
    const names = candidates.map((n) => n.name);
    return { ok: false, result: { kind: 'clarify', question: `"${raw}" could mean ${names.slice(0, 4).join(', ')}. Which one do you mean?`, options: names.slice(0, 4) } };
  }
  const suggestions = closeNames(doc, raw);
  const listing = doc.graph.nodes.length === 0 ? 'The diagram is empty.' : `Components here: ${doc.graph.nodes.slice(0, 6).map((n) => n.name).join(', ')}.`;
  return { ok: false, result: { kind: 'clarify', question: `I couldn't find a component called "${raw}". ${listing}`, options: suggestions } };
}

function both(doc: DiagramDoc, aliases: AliasMap, a: string, b: string): { a: Extract<Resolved, { ok: true }>; b: Extract<Resolved, { ok: true }> } | Extract<ParseResult, { kind: 'clarify' }> {
  const ra = resolveRef(doc, aliases, a);
  if (!ra.ok) return ra.result;
  const rb = resolveRef(doc, aliases, b);
  if (!rb.ok) return rb.result;
  if (ra.alias === rb.alias) return { kind: 'clarify', question: `"${ra.name}" and "${rb.name}" are the same component. Which two components do you mean?`, options: [] };
  return { a: ra, b: rb };
}

const label = (e: { relationship?: string | undefined }) => e.relationship ?? '(no label)';

export function parseCommand(doc: DiagramDoc, input: string): ParseResult {
  const original = input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*,)?\s*please[.!?]*$/i, '')
    .replace(/[.!?]+$/, '');
  const polite = /^(?:(?:please|kindly|ok(?:ay)?|hey|so)\s+|(?:can|could|would) you\s+|i(?:'d| would) like (?:you )?to\s+|i want (?:you )?to\s+|let'?s\s+|go ahead and\s+)+/i;
  const text = original.replace(polite, '').trim();
  if (!text || text.length > 300) return { kind: 'none' };

  const aliases = buildAliases(doc);
  const edgesBetween = (aAlias: string, bAlias: string) => {
    const a = aliases.aliasToNode.get(aAlias)!;
    const b = aliases.aliasToNode.get(bAlias)!;
    const pick = (s: string, t: string) => doc.graph.edges.filter((e) => e.sourceNodeId === s && e.targetNodeId === t);
    return { forward: pick(a, b), reverse: pick(b, a) };
  };
  const edgeAlias = (id: string) => aliases.edgeToAlias.get(id)!;

  let m: RegExpExecArray | null;

  // --- reset (never executed from text) ---
  if (/^(?:reset|clear|wipe|start over|delete everything|clear everything)(?:\s+(?:the\s+)?(?:diagram|canvas|everything|all|board))?$/i.test(text)) {
    return { kind: 'clarify', question: "Clearing the whole diagram can't be undone yet, so I won't do it from a typed command. Use the Reset button in the header; it asks you to confirm.", options: [] };
  }

  // --- insert between ---
  if ((m = /^(?:put|insert|add|place|drop|stick|slot)\s+(?:in\s+)?(?:a\s+|an\s+|the\s+|new\s+)*(.+?)\s+(?:in\s+)?between\s+(.+?)\s+and\s+(.+)$/i.exec(text))) {
    const name = stripSuffix(m[1]!);
    if (!name || name.length > 120) return { kind: 'none' };
    const pair = both(doc, aliases, m[2]!, m[3]!);
    if ('kind' in pair) return pair;
    const { forward, reverse } = edgesBetween(pair.a.alias, pair.b.alias);
    if (forward.length === 1) {
      return { kind: 'steps', steps: [{ type: 'INSERT_BETWEEN', name, source: pair.a.alias, target: pair.b.alias, edge: edgeAlias(forward[0]!.id) }] };
    }
    if (forward.length > 1) {
      return { kind: 'clarify', question: `There are ${forward.length} connections from ${pair.a.name} to ${pair.b.name}: ${forward.map(label).join(', ')}. Which one should ${name} go on?`, options: forward.map(label).slice(0, 4) };
    }
    if (reverse.length > 0) {
      return { kind: 'clarify', question: `The connection goes from ${pair.b.name} to ${pair.a.name}, not the other way. Which direction do you want?`, options: [`Put ${name} between ${pair.b.name} and ${pair.a.name}`] };
    }
    // Not connected at all: add the node and wire it in (adds only; nothing is removed).
    return {
      kind: 'steps',
      steps: [
        { type: 'ADD_NODE', name, as: 'new1' },
        { type: 'CONNECT', source: pair.a.alias, target: 'new1' },
        { type: 'CONNECT', source: 'new1', target: pair.b.alias },
      ],
    };
  }

  // --- disconnect ---
  const disconnect =
    /^(?:disconnect|unlink|detach)\s+(.+?)\s+(?:from|and)\s+(.+)$/i.exec(text) ??
    /^(?:remove|delete|drop|cut)\s+(?:the\s+)?(?:connection|link|arrow|edge|line)\s+(?:between|from)\s+(.+?)\s+(?:and|to)\s+(.+)$/i.exec(text);
  if (disconnect) {
    const pair = both(doc, aliases, disconnect[1]!, disconnect[2]!);
    if ('kind' in pair) return pair;
    const { forward, reverse } = edgesBetween(pair.a.alias, pair.b.alias);
    const all = [...forward, ...reverse];
    if (all.length === 0) return { kind: 'clarify', question: `${pair.a.name} and ${pair.b.name} are not connected.`, options: [] };
    if (forward.length > 1 || reverse.length > 1 || (forward.length === 1 && reverse.length === 1)) {
      return { kind: 'clarify', question: `There are several connections between ${pair.a.name} and ${pair.b.name}. Which one should I remove?`, options: [...forward.map((e) => `${pair.a.name} to ${pair.b.name} ${label(e)}`), ...reverse.map((e) => `${pair.b.name} to ${pair.a.name} ${label(e)}`)].slice(0, 4) };
    }
    return { kind: 'steps', steps: [{ type: 'DISCONNECT', edge: edgeAlias(all[0]!.id) }] };
  }

  // --- connect ---
  const connect =
    /^(?:connect|link|wire|join)\s+(.+?)\s+(?:to|with|and|->|→)\s+(.+)$/i.exec(text) ??
    /^(?:draw|add|create|make)\s+(?:a\s+|an\s+)?(?:connection|arrow|line|link|edge)\s+from\s+(.+?)\s+to\s+(.+)$/i.exec(text) ??
    /^(.+?)\s*(?:->|→)\s*(.+)$/.exec(text);
  if (connect) {
    const pair = both(doc, aliases, connect[1]!, connect[2]!);
    if ('kind' in pair) return pair;
    return { kind: 'steps', steps: [{ type: 'CONNECT', source: pair.a.alias, target: pair.b.alias }] };
  }

  // --- rename ---
  if ((m = /^(?:rename|call|name)\s+(.+?)\s+(?:to|as)\s+(.+)$/i.exec(text))) {
    const target = resolveRef(doc, aliases, m[1]!);
    if (!target.ok) return target.result;
    const name = m[2]!.trim().replace(/^["'`]|["'`]$/g, '');
    if (!name || name.length > 120) return { kind: 'none' };
    return { kind: 'steps', steps: [{ type: 'RENAME_NODE', ref: target.alias, name }] };
  }

  // --- remove (one component) ---
  if ((m = /^(?:remove|delete|drop|get rid of)\s+(?:the\s+)?(.+)$/i.exec(text)) && !/\b(?:and|,|connection|link|arrow|edge)\b/i.test(m[1]!)) {
    const target = resolveRef(doc, aliases, m[1]!);
    if (!target.ok) return target.result;
    return { kind: 'steps', steps: [{ type: 'REMOVE_NODE', ref: target.alias }] };
  }

  // --- add (one component) ---
  if ((m = /^(?:add|create|new|spin up)\s+(?:a\s+|an\s+|the\s+|new\s+)*(.+?)(?:\s+(?:to|into|in|on)\s+(?:the\s+|this\s+|my\s+)?(?:diagram|canvas|board|architecture))?$/i.exec(text))) {
    const name = stripSuffix(m[1]!);
    if (name && name.length <= 120 && !/\b(?:and|between|connect|connected|with|from|then|to)\b|,/i.test(name)) {
      return { kind: 'steps', steps: [{ type: 'ADD_NODE', name }] };
    }
  }

  return { kind: 'none' };
}
