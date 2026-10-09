import type { NodeKind } from '@tinker/shared';
import type { DiagramDoc } from '../../diagrams/domain/index.ts';
import { buildAliases, type AliasMap, type PlanStep } from '../domain/plan.ts';
import { WIRING_EXPLANATION, suggestWiring } from '../domain/wiring.ts';

/**
 * Deterministic parser: the fast path for plain commands ("put Redis between Orders and PostgreSQL"). It never calls a model.
 * Rules: a reference must resolve to exactly ONE component (exact name, else an unambiguous partial name, else a UUID).
 * Anything unknown or ambiguous becomes a clarification question; anything it does not recognise returns `none` so the
 * model gets a chance. Typed RESET is deliberately never executed (destructive and not yet undoable).
 *
 * `propose`: the request needs a component that is not in the diagram yet ("put a cache between Orders and the database" with no
 * database). Nothing is applied: the user is asked first, and the plan is kept by the server so that "yes" applies exactly that.
 */
export type ParseResult =
  /** `note`: something worth telling the person after the change (what was guessed, what could not be placed). */
  | { kind: 'steps'; steps: PlanStep[]; note?: string }
  | { kind: 'clarify'; question: string; options: string[] }
  | { kind: 'propose'; question: string; steps: PlanStep[] }
  | { kind: 'none' };

/**
 * People say "the database", not "PostgreSQL": a word for a KIND of component refers to the component of that kind. With exactly one
 * it is that one, with several the user is asked which, with none the user is offered to add it.
 */
const KIND_WORDS: Record<string, NodeKind> = {
  database: 'DATABASE', db: 'DATABASE', datastore: 'DATABASE', 'data store': 'DATABASE',
  cache: 'CACHE', 'cache layer': 'CACHE', caching: 'CACHE',
  queue: 'QUEUE', 'message queue': 'QUEUE', broker: 'QUEUE', 'message broker': 'QUEUE',
  gateway: 'GATEWAY', 'api gateway': 'GATEWAY',
  client: 'CLIENT', frontend: 'CLIENT', 'front end': 'CLIENT', browser: 'CLIENT',
};
const KIND_LABEL: Partial<Record<NodeKind, string>> = { DATABASE: 'database', CACHE: 'cache', QUEUE: 'message queue', GATEWAY: 'gateway', CLIENT: 'client' };
const KIND_DEFAULT_NAME: Partial<Record<NodeKind, string>> = { DATABASE: 'Database', CACHE: 'Cache', QUEUE: 'Message Queue', GATEWAY: 'API Gateway', CLIENT: 'Client' };
const QUALIFIER = /\s+(?:database|db|cache|queue|service|gateway|component|server)$/;

/** A reference to something that does not exist yet: what to call it if the user agrees to add it. */
interface Missing {
  raw: string;
  /** Wording for the question: "a database" or the quoted name. */
  phrase: string;
  name: string;
  kind?: NodeKind;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`"'’]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** "cache" -> "Cache", "kafka queue" -> "Kafka Queue". Anything with a capital letter was written on purpose ("PostgreSQL", "iOS App") and is left alone. */
export const tidyName = (s: string): string => (s === s.toLowerCase() ? s.replace(/(^|\s)(\p{L})/gu, (_m, space: string, letter: string) => `${space}${letter.toUpperCase()}`) : s);

const stripSuffix = (s: string) => s.replace(/\s+(?:node|service|component|box|block|layer)$/i, '').trim();

type Resolved = { ok: true; alias: string; name: string } | { ok: false; result: Extract<ParseResult, { kind: 'clarify' | 'none' }>; missing?: Missing };

/** Edit distance, for typos ("Ordrs" for "Orders"). Small inputs only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** Components whose name is a typo of what was typed: the whole name, or one word of it, within a couple of letters. */
function typoNames(doc: DiagramDoc, raw: string): string[] {
  const q = norm(raw);
  if (q.length < 4) return [];
  const limit = q.length >= 8 ? 2 : 1;
  return doc.graph.nodes
    .filter((n) => {
      const name = norm(n.name);
      return distance(q, name) <= limit || name.split(' ').some((w) => w.length >= 4 && distance(q, w) <= limit);
    })
    .map((n) => n.name)
    .slice(0, 4);
}

function closeNames(doc: DiagramDoc, raw: string): string[] {
  const q = norm(raw);
  const tokens = new Set(q.split(' ').filter((t) => t.length > 2));
  const typos = new Set(typoNames(doc, raw));
  return doc.graph.nodes
    .map((n) => {
      const name = norm(n.name);
      const overlap = name.split(' ').filter((t) => tokens.has(t)).length;
      const near = name.includes(q) || q.includes(name) ? 2 : 0;
      return { name: n.name, score: overlap + near + (typos.has(n.name) ? 3 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.name)
    .slice(0, 4);
}

/**
 * A reference that reads like a DESCRIPTION ("an event queue from orders", "a new billing service") is not a name the
 * parser can resolve or reasonably ask about: leave the whole request to the model instead of mis-parsing it.
 */
function looksLikeDescription(raw: string): boolean {
  const q = norm(raw);
  return q.split(' ').length > 4 || /^new\b/.test(q) || /\b(?:and|from|that|which|using|via|for|into|on top of)\b/.test(q) || /,/.test(raw);
}

function resolveRef(doc: DiagramDoc, aliases: AliasMap, rawIn: string): Resolved {
  const raw = stripSuffix(rawIn.trim().replace(/[.!?]+$/, ''));
  const byId = UUID.test(raw) ? doc.graph.nodes.find((n) => n.id.toLowerCase() === raw.toLowerCase()) : undefined;
  const found = (id: string, name: string): Resolved => ({ ok: true, alias: aliases.nodeToAlias.get(id)!, name });
  if (byId) return found(byId.id, byId.name);

  const q = norm(raw);
  const exact = doc.graph.nodes.filter((n) => norm(n.name) === q);
  if (exact.length === 1) return found(exact[0]!.id, exact[0]!.name);
  // Only an exact name may match a description-like phrase; partial matching would grab "orders" out of
  // "a cache that sits in front of orders" and silently act on the wrong thing.
  if (exact.length === 0 && looksLikeDescription(raw)) return { ok: false, result: { kind: 'none' } };

  // "the database": the component OF THAT KIND (a name match above always wins).
  const kindWord = exact.length === 0 ? KIND_WORDS[q] : undefined;
  if (kindWord) {
    const ofKind = doc.graph.nodes.filter((n) => n.kind === kindWord);
    if (ofKind.length === 1) return found(ofKind[0]!.id, ofKind[0]!.name);
    if (ofKind.length > 1) {
      const names = ofKind.map((n) => n.name);
      return { ok: false, result: { kind: 'clarify', question: `There is more than one ${KIND_LABEL[kindWord]}: ${names.slice(0, 4).join(', ')}. Which one do you mean?`, options: names.slice(0, 4) } };
    }
  }
  // "the postgres database": the qualifying word is a hint, the rest is the name.
  const core = q.replace(QUALIFIER, '');
  const partial = (needle: string) =>
    doc.graph.nodes.filter((n) => {
      const name = norm(n.name);
      return needle.length >= 3 && name.length >= 3 && (name.includes(needle) || needle.includes(name));
    });
  const candidates =
    exact.length > 1
      ? exact
      : (() => {
          const direct = partial(q);
          return direct.length > 0 || core === q ? direct : partial(core);
        })();
  if (candidates.length === 1) return found(candidates[0]!.id, candidates[0]!.name);
  if (candidates.length > 1) {
    const names = candidates.map((n) => n.name);
    return { ok: false, result: { kind: 'clarify', question: `"${raw}" could mean ${names.slice(0, 4).join(', ')}. Which one do you mean?`, options: names.slice(0, 4) } };
  }
  if (looksLikeDescription(raw)) return { ok: false, result: { kind: 'none' } };
  const listing = doc.graph.nodes.length === 0 ? 'The diagram is empty.' : `Components here: ${doc.graph.nodes.slice(0, 6).map((n) => n.name).join(', ')}.`;

  if (kindWord) {
    // No component of that kind, and none named like it: the caller decides whether offering to add one makes sense.
    const label = KIND_LABEL[kindWord]!;
    return {
      ok: false,
      result: { kind: 'clarify', question: `There is no ${label} in this diagram yet. ${listing}`, options: [] },
      missing: { raw, phrase: `a ${label}`, name: KIND_DEFAULT_NAME[kindWord]!, kind: kindWord },
    };
  }
  const suggestions = closeNames(doc, raw);
  const typos = typoNames(doc, raw);
  if (typos.length > 0) {
    return { ok: false, result: { kind: 'clarify', question: `I couldn't find a component called "${raw}". Did you mean ${typos.slice(0, 3).join(' or ')}?`, options: typos } };
  }
  const missing: Missing | undefined = nameWorthAdding(raw) ? { raw, phrase: `"${displayName(raw)}"`, name: displayName(raw) } : undefined;
  return {
    ok: false,
    result: { kind: 'clarify', question: `I couldn't find a component called "${raw}". ${listing}`, options: suggestions },
    ...(missing && suggestions.length === 0 ? { missing } : {}),
  };
}

/** Something that reads like a component NAME (short, no sentence): worth offering to add when it does not exist. */
function nameWorthAdding(raw: string): boolean {
  const words = raw.trim().split(/\s+/);
  return raw.length >= 2 && raw.length <= 40 && words.length <= 3 && /^[\p{L}\p{N}][\p{L}\p{N} ._&+-]*$/u.test(raw) && !/^(?:it|that|this|them|there|everything|all)$/i.test(raw.trim());
}
const displayName = (raw: string) => tidyName(raw.trim().replace(/^(?:the|a|an)\s+/i, '').replace(/\s+/g, ' '));

type Found = Extract<Resolved, { ok: true }>;
type Pair = { a: Found; b: Found };
/** Exactly one of the two components is missing and could be added; the other one exists. */
type OneMissing = { missing: Missing; side: 'a' | 'b'; other: Found; fallback: Extract<ParseResult, { kind: 'clarify' | 'none' }> };

function both(doc: DiagramDoc, aliases: AliasMap, a: string, b: string): Pair | OneMissing | Extract<ParseResult, { kind: 'clarify' | 'none' }> {
  const ra = resolveRef(doc, aliases, a);
  const rb = resolveRef(doc, aliases, b);
  if (!ra.ok && rb.ok && ra.missing) return { missing: ra.missing, side: 'a', other: rb, fallback: ra.result };
  if (!rb.ok && ra.ok && rb.missing) return { missing: rb.missing, side: 'b', other: ra, fallback: rb.result };
  if (!ra.ok) return ra.result;
  if (!rb.ok) return rb.result;
  if (ra.alias === rb.alias) return { kind: 'clarify', question: `"${ra.name}" and "${rb.name}" are the same component. Which two components do you mean?`, options: [] };
  return { a: ra, b: rb };
}

const label = (e: { relationship?: string | undefined }) => e.relationship ?? '(no label)';

const isPair = (v: Pair | OneMissing | Extract<ParseResult, { kind: 'clarify' | 'none' }>): v is Pair => 'a' in v && 'b' in v;
const isOneMissing = (v: Pair | OneMissing | Extract<ParseResult, { kind: 'clarify' | 'none' }>): v is OneMissing => 'missing' in v;

const addMissing = (m: Missing): PlanStep => ({ type: 'ADD_NODE', name: m.name, ...(m.kind ? { kind: m.kind } : {}), as: 'new1' });
const askToAdd = (m: Missing, action: string) =>
  `${m.kind ? `There is no ${m.phrase.replace(/^a /, '')} in the diagram yet.` : `I couldn't find ${m.phrase} in the diagram.`} Should I ${m.kind ? `add one ("${m.name}")` : 'add it'} and ${action}?`;

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

  // --- connect everything: "connect the components logically", "wire everything up", "link them together" ---
  if (asksToWireEverything(text)) return wireEverything(doc, aliases);

  // --- reset (never executed from text) ---
  if (
    /^(?:reset|clear|wipe|start over|delete everything|clear everything)(?:\s+(?:the\s+)?(?:diagram|canvas|everything|all|board))?$/i.test(text) ||
    /^(?:reset|clear|wipe|erase|empty|delete|remove|destroy)\s+(?:the\s+|my\s+|this\s+)?(?:whole\s+|entire\s+|full\s+)?(?:diagram|canvas|board|architecture|everything|all(?:\s+of\s+it|\s+components|\s+nodes)?)$/i.test(text)
  ) {
    return { kind: 'clarify', question: "Clearing the whole diagram can't be undone yet, so I won't do it from a typed command. Use the Reset button in the header; it asks you to confirm.", options: [] };
  }

  // --- insert between ---
  if ((m = /^(?:put|insert|add|place|drop|stick|slot)\s+(?:in\s+)?(?:a\s+|an\s+|the\s+|new\s+)*(.+?)\s+(?:in\s+)?between\s+(.+?)\s+and\s+(.+)$/i.exec(text))) {
    const name = tidyName(stripSuffix(m[1]!));
    if (!name || name.length > 120) return { kind: 'none' };
    const pair = both(doc, aliases, m[2]!, m[3]!);
    if (isOneMissing(pair)) {
      // One end does not exist: offer to add it and wire the new component in between. Nothing is applied until the user says yes.
      const [first, last] = pair.side === 'a' ? ['new1', pair.other.alias] : [pair.other.alias, 'new1'];
      return {
        kind: 'propose',
        question: askToAdd(pair.missing, `put ${name} between ${pair.side === 'a' ? `it and ${pair.other.name}` : `${pair.other.name} and it`}`),
        steps: [addMissing(pair.missing), { type: 'ADD_NODE', name, as: 'new2' }, { type: 'CONNECT', source: first, target: 'new2' }, { type: 'CONNECT', source: 'new2', target: last }],
      };
    }
    if (!isPair(pair)) return pair;
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
    if (isOneMissing(pair)) return pair.fallback;
    if (!isPair(pair)) return pair;
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
    if (isOneMissing(pair)) {
      const [source, target] = pair.side === 'a' ? ['new1', pair.other.alias] : [pair.other.alias, 'new1'];
      return {
        kind: 'propose',
        question: askToAdd(pair.missing, `connect ${pair.side === 'a' ? `it to ${pair.other.name}` : `${pair.other.name} to it`}`),
        steps: [addMissing(pair.missing), { type: 'CONNECT', source, target }],
      };
    }
    if (!isPair(pair)) return pair;
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

  // --- add with an explicit name: "add a database called Reports" ---
  if ((m = /^(?:add|create|new|spin up)\s+(?:a\s+|an\s+|the\s+|new\s+)*(.+?)\s+(?:called|named|titled)\s+["'`]?(.+?)["'`]?$/i.exec(text))) {
    const name = m[2]!.trim();
    const hint = KIND_WORDS[norm(stripSuffix(m[1]!))];
    if (name && name.length <= 120 && !/\b(?:and|between|connect|connected|then|to|after|before|behind|that|which)\b|,/i.test(name)) {
      return { kind: 'steps', steps: [{ type: 'ADD_NODE', name, ...(hint ? { kind: hint } : {}) }] };
    }
    return { kind: 'none' };
  }

  // --- add (one component) ---
  if ((m = /^(?:add|create|new|spin up)\s+(?:a\s+|an\s+|the\s+|new\s+)*(.+?)(?:\s+(?:to|into|in|on)\s+(?:the\s+|this\s+|my\s+)?(?:diagram|canvas|board|architecture))?$/i.exec(text))) {
    const name = tidyName(stripSuffix(m[1]!));
    const notJustAName = /\b(?:and|between|connect(?:ed)?|with|from|then|to|after|before|behind|beside|near|next to|in front of|infront of|above|below|under|over|using|via|inside|within|alongside|around|on top of|that|which|for|so that|instead)\b|,/i;
    // "two caches", "3 queues": a count is more than a name: the model (or a clear question) handles it.
    if (/\b(?:two|three|four|five|six|several|some|many|few|\d+)\b/i.test(name)) return { kind: 'none' };
    if (/^(?:new|node|component|something|thing|one|another|box|block|service|item|element)$/i.test(name)) {
      return { kind: 'clarify', question: 'What should the new component be called?', options: [] };
    }
    if (name && name.length <= 120 && !notJustAName.test(name)) {
      return { kind: 'steps', steps: [{ type: 'ADD_NODE', name }] };
    }
  }

  return { kind: 'none' };
}

const WIRE_VERB = /^(?:please\s+)?(?:auto[- ]?)?(?:connect|link|wire|join|hook|map|attach|tie|lay out|arrange|organi[sz]e)\b/i;
const WIRE_OBJECT = /\b(?:components?|nodes?|boxes|blocks|services|everything|them|these|those|all|it all|diagram|architecture|system|canvas|design)\b/i;
/** Words that may appear in such a request without naming a specific pair ("connect all the components logically for me"). */
const WIRE_FILLER = new Set(
  'connect link wire join hook map attach tie lay out arrange organise organize auto autoconnect all the my these those every everything components component nodes node boxes blocks services them it up together logically properly sensibly correctly automatically for me please in a logical sensible way diagram architecture system canvas design here on and then to each other one another with'.split(' '),
);

/** "Connect everything logically" and its many phrasings, but not "connect Orders to Billing" (that names a pair and has its own rule). */
function asksToWireEverything(text: string): boolean {
  if (!WIRE_VERB.test(text) || !WIRE_OBJECT.test(text)) return false;
  const rest = text.toLowerCase().replace(/[^a-z\s-]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!rest.every((w) => WIRE_FILLER.has(w))) return false;
  // "connect all to X" names a target: leave that to the pair rule.
  return !/\b(?:to|with)\s+(?!each other|one another|them|it|everything|all)\w/i.test(text);
}

/** Connect the components that are not connected yet, by the rules in `wiring.ts`. Only adds; never removes or changes anything. */
function wireEverything(doc: DiagramDoc, aliases: AliasMap): ParseResult {
  if (doc.graph.nodes.length < 2) return { kind: 'clarify', question: 'There is nothing to connect yet: add at least two components first.', options: [] };
  const result = suggestWiring(doc);
  if (result.edges.length === 0) {
    const unplaced = result.unplaced.length > 0 ? ` I could not tell where ${result.unplaced.slice(0, 4).join(', ')} belong${result.unplaced.length === 1 ? 's' : ''}: connect ${result.unplaced.length === 1 ? 'it' : 'them'} yourself, or tell me how.` : '';
    return { kind: 'clarify', question: `Everything I can place is already connected.${unplaced}`, options: [] };
  }
  const steps: PlanStep[] = result.edges.map((e) => ({ type: 'CONNECT', source: aliases.nodeToAlias.get(e.source)!, target: aliases.nodeToAlias.get(e.target)!, relationship: e.relationship }));
  const notes = [WIRING_EXPLANATION];
  if (result.guessed.length > 0) notes.push(`Where names did not say, I paired ${result.guessed.slice(0, 3).join('; ')}. Check those.`);
  if (result.unplaced.length > 0) notes.push(`Not connected: ${result.unplaced.slice(0, 4).join(', ')}.`);
  return { kind: 'steps', steps, note: notes.join(' ') };
}
