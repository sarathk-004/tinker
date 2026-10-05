import { useDiagramStore, inferAWSDetails, sanitizeId } from '../diagram/store';
import { useConversationStore } from './conversationStore';
import { DIAGRAM_TOOLS } from './tools';
import { buildSystemPrompt, buildContentsWithHistory } from './prompts';
import { speakWithGeminiVoice } from './geminiVoice';

interface ExecutionResult {
  success: boolean;
  actionsExecuted: string[];
  error?: string;
  source: 'gemini' | 'local_fallback';
}

export async function processArchitectureInstruction(
  input: string,
  apiKeyOverride?: string
): Promise<ExecutionResult> {
  const store = useDiagramStore.getState();
  const conversation = useConversationStore.getState();
  const storedKey =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('tinker_gemini_api_key') || localStorage.getItem('tinker_gemini_key')
      : null;
  const apiKey =
    apiKeyOverride ||
    storedKey ||
    (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '') ||
    '';

  const simplifiedNodes = store.nodes.map((n) => ({
    id: n.id,
    label: n.data.label,
    type: n.data.type,
    subType: n.data.subType,
  }));

  const simplifiedEdges = store.edges.map((e) => ({
    source: e.source,
    target: e.target,
  }));

  // Record user turn in conversation history
  conversation.addTurn({ role: 'user', text: input });

  let result: ExecutionResult;

  // If user has provided a Gemini API Key, use real Gemini 2.0 Flash
  if (apiKey && apiKey.trim().length > 10) {
    try {
      result = await callGeminiAPI(input, apiKey.trim(), simplifiedNodes, simplifiedEdges);
      // If Gemini returned no actions, check if rule engine can handle it
      if (!result.success || result.actionsExecuted.length === 0) {
        const fallback = executeLocalRuleEngine(input, simplifiedNodes, simplifiedEdges);
        if (fallback.success) {
          result = fallback;
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Gemini API Error:', errMsg);
      result = {
        success: false,
        actionsExecuted: [],
        error: `Gemini API Error: ${errMsg}`,
        source: 'gemini',
      };
    }
  } else {
    // Fallback local architectural reasoning engine
    result = executeLocalRuleEngine(input, simplifiedNodes, simplifiedEdges);
  }

  // Record assistant turn in conversation history
  if (!result.actionsExecuted.includes('Reset canvas') && !result.actionsExecuted.includes('Canvas reset')) {
    // If only primitive diagram edits occurred, don't spam "Added (...)"
    const hasExplanation = result.actionsExecuted.some(
      (a) => !/^(?:Added|Removed|Connected|Disconnected|Inserted|Renamed|Highlighted)/i.test(a)
    );

    const explanationText = result.actionsExecuted
      .filter((a) => !/^(?:Added|Removed|Connected|Disconnected|Inserted|Renamed|Highlighted)/i.test(a))
      .join('\n\n');

    conversation.addTurn({
      role: 'assistant',
      text: hasExplanation ? explanationText : 'Diagram updated.',
      actions: result.actionsExecuted,
      source: result.source,
    });
  }

  // Nuanced Voice response using Gemini Voice
  if (result.success && result.actionsExecuted.length > 0) {
    const explanations = result.actionsExecuted.filter(
      (a) => !/^(?:Added|Removed|Connected|Disconnected|Inserted|Renamed|Highlighted)/i.test(a)
    );

    // Only speak aloud and animate flow when answering architectural questions or simulations
    if (explanations.length > 0) {
      speakWithGeminiVoice(explanations.join('. '));
      // Automatically show the flow sequentially across the diagram
      store.playFlow();
    }
  }

  return result;
}

// -------------------------------------------------------------
// Gemini 3.8 Flash API Call — Multi-turn with History
// -------------------------------------------------------------
async function callGeminiAPI(
  userInput: string,
  apiKey: string,
  nodes: Array<{ id: string; label: string; type: string; subType?: string }>,
  edges: Array<{ source: string; target: string }>
): Promise<ExecutionResult> {
  const candidateModels = [
    (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_MODEL : '') || 'gemini-3.8-flash',
    'gemini-3.8-flash',
  ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i) as string[];

  const systemPrompt = buildSystemPrompt({ nodes, edges });
  const history = useConversationStore.getState().getHistory();
  // Build multi-turn contents (exclude the current turn we just added — it's appended by buildContentsWithHistory)
  const previousTurns = history.slice(0, -1); // remove the user turn we just added above
  const contents = buildContentsWithHistory(previousTurns, userInput);

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 300,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
    tools: [
      {
        functionDeclarations: DIAGRAM_TOOLS,
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    },
  };

  let response: Response | null = null;
  let lastErrorText = '';

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        response = res;
        break;
      }

      lastErrorText = await res.text();
      // If model not found / deprecated (404), try next model
      if (res.status === 404) {
        console.warn(`Gemini model ${model} returned 404, attempting fallback...`);
        continue;
      } else {
        // Quota, auth, or validation error
        throw new Error(`Gemini API error (${res.status}): ${lastErrorText}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Gemini API error')) {
        throw err;
      }
      lastErrorText = err instanceof Error ? err.message : String(err);
    }
  }

  if (!response || !response.ok) {
    throw new Error(`Gemini API error: ${lastErrorText || 'All candidate models failed'}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];

  const store = useDiagramStore.getState();
  const executedActions: string[] = [];

  for (const part of parts) {
    if (part.functionCall) {
      const { name, args } = part.functionCall;
      const desc = executeFunctionCall(name, args, store);
      if (desc) executedActions.push(desc);
      if (parts.length > 1) {
        // Progressive live render step: allows user to see nodes appear live
        await new Promise((resolve) => setTimeout(resolve, 140));
      }
    } else if (part.text && part.text.trim()) {
      executedActions.push(part.text.trim());
    }
  }

  return {
    success: executedActions.length > 0,
    actionsExecuted: executedActions,
    source: 'gemini',
  };
}

// -------------------------------------------------------------
// Action Dispatcher
// -------------------------------------------------------------
function executeFunctionCall(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  store: ReturnType<typeof useDiagramStore.getState>
): string | null {
  switch (name) {
    case 'addNode': {
      const id = store.addNode({
        id: args.id,
        label: args.label,
        type: args.type,
        subType: args.subType,
      });
      return `Added ${args.label} (${id})`;
    }

    case 'removeNode': {
      store.removeNode(args.id);
      return `Removed ${args.id}`;
    }

    case 'connect': {
      store.connect(args.source, args.target, args.label, args.bidirectional);
      return args.bidirectional
        ? `Connected ${args.source} ↔ ${args.target}`
        : `Connected ${args.source} → ${args.target}`;
    }

    case 'disconnect': {
      store.disconnect(args.source, args.target);
      return `Disconnected ${args.source} ↮ ${args.target}`;
    }

    case 'insertBetween': {
      store.insertBetween(args.source, args.target, {
        id: args.id,
        label: args.label,
        type: args.type,
        subType: args.subType,
      });
      return `Inserted ${args.label} between ${args.source} and ${args.target}`;
    }

    case 'renameNode': {
      store.renameNode(args.id, args.newLabel);
      return `Renamed ${args.id} to ${args.newLabel}`;
    }

    case 'highlight': {
      store.highlight(args.ids || []);
      return `Highlighted [${(args.ids || []).join(', ')}]`;
    }

    case 'explainOrAnswer': {
      if (args.highlightNodeIds && args.highlightNodeIds.length > 0) {
        store.highlight(args.highlightNodeIds);
      }
      return args.explanation;
    }

    case 'reset': {
      store.reset();
      useConversationStore.getState().clear();
      return 'Canvas reset';
    }

    default:
      console.warn('Unknown function call from Gemini:', name, args);
      return null;
  }
}

// -------------------------------------------------------------
// Fallback Natural Language Rule Engine
// -------------------------------------------------------------
function executeLocalRuleEngine(
  text: string,
  nodes: Array<{ id: string; label: string; type: string }>,
  edges: Array<{ source: string; target: string }>
): ExecutionResult {
  const store = useDiagramStore.getState();
  const lower = text.toLowerCase().trim();
  const executedActions: string[] = [];

  // --- Reset / Clear ---
  if (/^(reset|clear|reset\s+canvas|clear\s+canvas|start\s+over|clear\s+all)$/i.test(lower)) {
    store.reset();
    useConversationStore.getState().clear();
    return { success: true, actionsExecuted: ['Reset canvas'], source: 'local_fallback' };
  }

  // --- Unhighlight / Clear highlight ---
  if (/^(unhighlight|clear\s+highlight|remove\s+highlight)/i.test(lower)) {
    store.clearHighlight();
    return { success: true, actionsExecuted: ['Cleared highlights'], source: 'local_fallback' };
  }

  // --- Conversational Q&A: Failure Analysis ("What happens if Auth goes down?") ---
  const failureMatch = lower.match(
    /(?:what\s+happens\s+if|what\s+if|if)\s+([a-z0-9_\s]+?)\s+(?:goes\s+down|fails|crashes|is\s+down|stops\s+working|is\s+removed|dies)(?:\s*[?!.]?\s*$)/i
  );
  if (failureMatch) {
    const rawTarget = failureMatch[1].trim();
    const targetId = findMatchingNodeId(rawTarget, nodes);
    if (targetId) {
      const targetNode = nodes.find((n) => n.id === targetId);
      const incoming = edges.filter((e) => e.target === targetId).map((e) => e.source);
      const outgoing = edges.filter((e) => e.source === targetId).map((e) => e.target);
      const blastRadius = Array.from(new Set([targetId, ...incoming, ...outgoing]));
      store.highlight(blastRadius);

      let answer = '';
      if (targetId.includes('auth')) {
        answer = `If Auth goes down, token verification and user authentication will fail. The API Gateway will reject unauthenticated client requests with 401 Unauthorized or 503 errors, blocking access to downstream backend services like Orders.`;
      } else if (targetId.includes('redis') || targetId.includes('cache')) {
        answer = `If Redis Cache goes down, read traffic will bypass cache and hit the PostgreSQL database directly, causing cache stampedes and increased response latency. Data integrity remains safe.`;
      } else if (targetId.includes('postgres') || targetId.includes('db') || targetId.includes('rds')) {
        answer = `If PostgreSQL goes down, persistent read and write transactions will fail, causing database timeouts and 500 internal server errors across all connected services.`;
      } else if (targetId.includes('gateway') || targetId.includes('alb')) {
        answer = `If API Gateway goes down, all external ingress traffic is completely cut off, preventing clients from communicating with any backend microservices.`;
      } else {
        const callers = incoming.length > 0 ? incoming.join(', ') : 'upstream clients';
        const targets = outgoing.length > 0 ? outgoing.join(', ') : 'downstream services';
        answer = `If ${targetNode?.label || targetId} fails, requests from ${callers} will fail or time out, blocking communication to ${targets}. Highlighting its blast radius on the canvas.`;
      }

      return {
        success: true,
        actionsExecuted: [answer],
        source: 'local_fallback',
      };
    }
  }

  // --- Conversational Q&A: Non-Technical Simplification ("Simplify this for a non-technical person") ---
  if (/(?:simplify|explain).*(?:non-technical|simple|layman|beginner|5\s+year\s+old|overview)/i.test(lower)) {
    const explanation = `In simple terms: this architecture functions like a digital retail store. The Client is the customer shopping on their phone. The API Gateway acts as the front desk receptionist directing visitors to the right department. The backend microservices process payments and manage catalog items, while the Cache and Database store customer records securely and quickly.`;
    store.highlight(nodes.map((n) => n.id));
    return {
      success: true,
      actionsExecuted: [explanation],
      source: 'local_fallback',
    };
  }

  // --- Flow Highlighting ("Highlight the payment flow") ---
  const flowHighlightMatch = lower.match(
    /highlight(?:\s+the)?\s+([a-z0-9_\s]+?)(?:\s+flow|\s+pipeline|\s+path)?(?:\s*[.!]?\s*$)/i
  );
  if (flowHighlightMatch && !flowHighlightMatch[1].startsWith('node')) {
    const term = flowHighlightMatch[1].trim();
    const matched = nodes.filter(
      (n) => n.id.includes(term) || n.label.toLowerCase().includes(term)
    );
    if (matched.length > 0) {
      const matchedIds = matched.map((n) => n.id);
      store.highlight(matchedIds);
      return {
        success: true,
        actionsExecuted: [`Highlighted ${term} flow [${matchedIds.join(', ')}]`],
        source: 'local_fallback',
      };
    }
  }

  // --- Grouping ("Group these three as backend services") ---
  const groupMatch = lower.match(
    /group\s+(?:these(?:\s+three|\s+nodes)?|all|the\s+services)\s+as\s+([a-z0-9_\s]+)(?:\s*[.!]?\s*$)/i
  );
  if (groupMatch) {
    const groupName = groupMatch[1].trim();
    const serviceNodes = nodes.filter(
      (n) => n.type === 'service' || !['client', 'gateway', 'database', 'cache'].includes(n.type)
    );
    const idsToGroup = serviceNodes.length > 0 ? serviceNodes.map((n) => n.id) : nodes.slice(-3).map((n) => n.id);
    store.highlight(idsToGroup);
    return {
      success: true,
      actionsExecuted: [`Grouped [${idsToGroup.join(', ')}] as ${groupName}`],
      source: 'local_fallback',
    };
  }

  // --- Bidirectional Connections ("Bidirectional connection between Client and Gateway" / "Client and Gateway talk to each other") ---
  const biMatch =
    lower.match(/(?:bidirectional|two-way|both\s+ways).*(?:between\s+([a-z0-9_\s]+?)\s+and\s+([a-z0-9_\s]+)|([a-z0-9_\s]+?)\s+(?:and|to)\s+([a-z0-9_\s]+))/i) ||
    lower.match(/([a-z0-9_\s]+?)\s+and\s+([a-z0-9_\s]+?)\s+talk\s+to\s+each\s+other/i);
  if (biMatch) {
    const rawSrc = (biMatch[1] || biMatch[3] || '').trim();
    const rawTgt = (biMatch[2] || biMatch[4] || '').trim();
    const srcId = findMatchingNodeId(rawSrc, nodes) || sanitizeId(rawSrc);
    const tgtId = findMatchingNodeId(rawTgt, nodes) || sanitizeId(rawTgt);
    if (srcId && tgtId) {
      store.connect(srcId, tgtId, undefined, true);
      return {
        success: true,
        actionsExecuted: [`Connected ${srcId} ↔ ${tgtId} bidirectionally`],
        source: 'local_fallback',
      };
    }
  }

  // --- INSERT_BETWEEN "between them" / "between the two" / "in between them" ---
  const insertBetweenThemMatch = lower.match(
    /(?:put|insert|add|place)\s+(?:a\s+|an\s+|the\s+)?([a-z0-9_\s]+?)\s+(?:in\s+)?between\s+(?:them|the\s+two|both|these(?:\s+two)?)(?:\s*[.!]?\s*$)/i
  );
  if (insertBetweenThemMatch) {
    const rawComponent = insertBetweenThemMatch[1]
      .replace(/^(a|an|the)\s+/, '')
      .replace(/\s+(?:in\s+)?between.*$/i, '')
      .trim();

    let sourceNode: string | undefined;
    let targetNode: string | undefined;

    if (nodes.length === 2) {
      const edge = edges[0];
      if (edge) {
        sourceNode = edge.source;
        targetNode = edge.target;
      } else {
        sourceNode = nodes[0].id;
        targetNode = nodes[1].id;
      }
    } else if (edges.length > 0) {
      const lastEdge = edges[edges.length - 1];
      sourceNode = lastEdge.source;
      targetNode = lastEdge.target;
    } else if (nodes.length >= 2) {
      sourceNode = nodes[nodes.length - 2].id;
      targetNode = nodes[nodes.length - 1].id;
    }

    if (sourceNode && targetNode) {
      const inferred = inferAWSDetails(rawComponent);
      store.insertBetween(sourceNode, targetNode, {
        label: capitalize(rawComponent),
        type: inferred.type,
        subType: inferred.subType,
        awsIcon: inferred.awsIcon,
      });
      return {
        success: true,
        actionsExecuted: [`Inserted ${capitalize(rawComponent)} between ${sourceNode} and ${targetNode}`],
        source: 'local_fallback',
      };
    }
  }

  // --- INSERT_BETWEEN (explicit X and Y) ---
  const insertMatch = lower.match(
    /(?:put|insert|add|place)\s+(?:a\s+|an\s+|the\s+)?([a-z0-9_\s]+?)\s+(?:in\s+)?between\s+([a-z0-9_\s]+?)\s+and\s+([a-z0-9_\s]+?)(?:\s*[.!]?\s*$)/i
  );
  if (insertMatch) {
    const rawComponent = insertMatch[1]
      .replace(/^(a|an|the)\s+/, '')
      .replace(/\s+(?:in\s+)?between.*$/i, '')
      .trim();
    const sourceNode = findMatchingNodeId(insertMatch[2].trim(), nodes);
    const targetNode = findMatchingNodeId(insertMatch[3].trim(), nodes);

    if (sourceNode && targetNode) {
      const inferred = inferAWSDetails(rawComponent);
      store.insertBetween(sourceNode, targetNode, {
        label: capitalize(rawComponent),
        type: inferred.type,
        subType: inferred.subType,
        awsIcon: inferred.awsIcon,
      });
      return {
        success: true,
        actionsExecuted: [`Inserted ${capitalize(rawComponent)} between ${sourceNode} and ${targetNode}`],
        source: 'local_fallback',
      };
    }
  }

  // --- RENAME ---
  const renameMatch = lower.match(/rename\s+([a-z0-9_\s]+?)\s+to\s+([a-z0-9_\s]+?)(?:\s*[.!]?\s*$)/i);
  if (renameMatch) {
    const targetId = findMatchingNodeId(renameMatch[1].trim(), nodes);
    if (targetId) {
      store.renameNode(targetId, capitalize(renameMatch[2].trim()));
      return {
        success: true,
        actionsExecuted: [`Renamed ${targetId} to ${capitalize(renameMatch[2].trim())}`],
        source: 'local_fallback',
      };
    }
  }

  // --- REMOVE ---
  const removeMatch = lower.match(/(?:remove|delete|drop)\s+(?:the\s+)?([a-z0-9_\s]+?)(?:\s*[.!]?\s*$)/i);
  if (removeMatch) {
    const targetId = findMatchingNodeId(removeMatch[1].trim(), nodes);
    if (targetId) {
      store.removeNode(targetId);
      return {
        success: true,
        actionsExecuted: [`Removed ${targetId}`],
        source: 'local_fallback',
      };
    }
  }

  // --- DISCONNECT ---
  const disconnectMatch = lower.match(/disconnect\s+([a-z0-9_\s]+?)\s+(?:from|and)\s+([a-z0-9_\s]+?)(?:\s*[.!]?\s*$)/i);
  if (disconnectMatch) {
    const src = findMatchingNodeId(disconnectMatch[1].trim(), nodes);
    const tgt = findMatchingNodeId(disconnectMatch[2].trim(), nodes);
    if (src && tgt) {
      store.disconnect(src, tgt);
      return {
        success: true,
        actionsExecuted: [`Disconnected ${src} ↮ ${tgt}`],
        source: 'local_fallback',
      };
    }
  }

  // --- HIGHLIGHT ---
  const highlightMatch = lower.match(/highlight\s+(?:the\s+)?(?:everything\s+connected\s+to\s+|the\s+)?([a-z0-9_,\s]+?)(?:\s+(?:flow|path|pipeline|stack))?\s*$/i);
  if (highlightMatch) {
    const rawTargets = highlightMatch[1].split(/,|\band\b/).map((s) => s.trim()).filter(Boolean);
    const matchedIds: string[] = [];

    rawTargets.forEach((t) => {
      const id = findMatchingNodeId(t, nodes);
      if (id) matchedIds.push(id);
    });

    if (matchedIds.length === 1) {
      // Expand to include neighbors
      const targetId = matchedIds[0];
      const neighbors = store.edges
        .filter((e) => e.source === targetId || e.target === targetId)
        .flatMap((e) => [e.source, e.target]);
      const unique = Array.from(new Set([targetId, ...neighbors]));
      store.highlight(unique);
      return {
        success: true,
        actionsExecuted: [`Highlighted ${unique.join(', ')}`],
        source: 'local_fallback',
      };
    } else if (matchedIds.length > 0) {
      store.highlight(matchedIds);
      return {
        success: true,
        actionsExecuted: [`Highlighted ${matchedIds.join(', ')}`],
        source: 'local_fallback',
      };
    }
  }

  // --- CONNECT ---
  const connectMatch = lower.match(/connect\s+(?:the\s+)?([a-z0-9_\s]+?)\s+to\s+(?:the\s+)?([a-z0-9_\s]+?)(?:\s*[.!]?\s*$)/i);
  if (connectMatch) {
    const src = findMatchingNodeId(connectMatch[1].trim(), nodes);
    const tgt = findMatchingNodeId(connectMatch[2].trim(), nodes);
    if (src && tgt) {
      store.connect(src, tgt);
      return {
        success: true,
        actionsExecuted: [`Connected ${src} → ${tgt}`],
        source: 'local_fallback',
      };
    }
  }

  // --- Multi-sentence architecture creation ---
  // "The client talks to an API gateway. The gateway connects to Auth and Orders."
  if (lower.includes('client') && (lower.includes('gateway') || lower.includes('api'))) {
    store.addNode({ id: 'client', label: 'Web Client', type: 'client', awsIcon: 'client' });
    store.addNode({ id: 'api_gw', label: 'API Gateway', type: 'gateway', awsIcon: 'api-gateway' });
    store.connect('client', 'api_gw');
    executedActions.push('Created Client → API Gateway');

    if (lower.includes('auth')) {
      store.addNode({ id: 'auth', label: 'Auth Service', type: 'service', awsIcon: 'ec2' });
      store.connect('api_gw', 'auth');
      executedActions.push('Created Auth Service');
    }
    if (lower.includes('order')) {
      store.addNode({ id: 'orders', label: 'Orders Service', type: 'service', awsIcon: 'ec2' });
      store.connect('api_gw', 'orders');
      executedActions.push('Created Orders Service');
    }
    if (lower.includes('payment')) {
      store.addNode({ id: 'payments', label: 'Payments Service', type: 'service', awsIcon: 'ec2' });
      store.connect('api_gw', 'payments');
      executedActions.push('Created Payments Service');
    }

    return {
      success: true,
      actionsExecuted: executedActions,
      source: 'local_fallback',
    };
  }

  // --- "X stores its data in Y" / "X talks to Y" / "X connects to Y" ---
  const storesMatch = lower.match(/([a-z0-9_\s]+?)\s+(?:stores\s+(?:its\s+)?data\s+in|talks\s+to|connects\s+to|sends\s+(?:data\s+)?to|writes\s+to|reads\s+from)\s+([a-z0-9_\s]+?)(?:\s*[.!]?\s*$)/i);
  if (storesMatch) {
    const srcName = storesMatch[1].replace(/^the\s+/, '').trim();
    const tgtName = storesMatch[2].replace(/^the\s+/, '').trim();

    let srcId = findMatchingNodeId(srcName, nodes);
    if (!srcId) {
      const inferred = inferAWSDetails(srcName);
      srcId = store.addNode({
        label: capitalize(srcName),
        type: inferred.type,
        awsIcon: inferred.awsIcon,
        subType: inferred.subType,
      });
      executedActions.push(`Added ${capitalize(srcName)}`);
    }

    // Refresh nodes after possible addition
    const currentNodes = useDiagramStore.getState().nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      type: n.data.type,
    }));

    let tgtId = findMatchingNodeId(tgtName, currentNodes);
    if (!tgtId) {
      const inferred = inferAWSDetails(tgtName);
      tgtId = store.addNode({
        label: capitalize(tgtName),
        type: inferred.type,
        awsIcon: inferred.awsIcon,
        subType: inferred.subType,
      });
      executedActions.push(`Added ${capitalize(tgtName)}`);
    }

    store.connect(srcId, tgtId);
    executedActions.push(`Connected ${srcId} → ${tgtId}`);

    return {
      success: true,
      actionsExecuted: executedActions,
      source: 'local_fallback',
    };
  }

  // --- Generic ADD ---
  const addMatch = lower.match(/(?:add|create)\s+(?:an?\s+|the\s+)?([a-z0-9_\s]+?)(?:\s*[.!]?\s*$)/i);
  if (addMatch) {
    const raw = addMatch[1].trim();
    const inferred = inferAWSDetails(raw);
    const id = store.addNode({
      label: capitalize(raw),
      type: inferred.type,
      awsIcon: inferred.awsIcon,
      subType: inferred.subType,
    });
    return {
      success: true,
      actionsExecuted: [`Added ${capitalize(raw)} (${id})`],
      source: 'local_fallback',
    };
  }

  return {
    success: false,
    actionsExecuted: [],
    error: `Could not understand: "${text}"`,
    source: 'local_fallback',
  };
}

// -------------------------------------------------------------
// Fuzzy Identifier Matching
// -------------------------------------------------------------
function findMatchingNodeId(
  search: string,
  nodes: Array<{ id: string; label: string }>
): string | null {
  const cleaned = search.replace(/^(the|a|an)\s+/i, '').trim().toLowerCase();
  const cleanSearch = sanitizeId(cleaned);

  // 0. Pronoun resolution: "it", "that", "the last one" -> target the most recent node
  if (cleaned === 'it' || cleaned === 'that' || cleaned === 'the last one' || cleaned === 'the component') {
    if (nodes.length > 0) {
      return nodes[nodes.length - 1].id;
    }
  }

  // Common aliases: "load balance" -> "load balancer" or "alb"
  if (cleaned.includes('load balance') || cleaned === 'alb' || cleaned === 'elb') {
    const albNode = nodes.find(
      (n) =>
        n.id.includes('load_balancer') ||
        n.id.includes('alb') ||
        n.label.toLowerCase().includes('balancer') ||
        n.label.toLowerCase().includes('balance')
    );
    if (albNode) return albNode.id;
  }

  // 1. Exact ID match
  const exact = nodes.find((n) => n.id === cleanSearch);
  if (exact) return exact.id;

  // 2. Label substring match (case-insensitive)
  const labelMatch = nodes.find((n) =>
    n.label.toLowerCase().includes(cleaned)
  );
  if (labelMatch) return labelMatch.id;

  // 3. Reverse label substring — user's search contains the node label
  const reverseLabel = nodes.find((n) =>
    cleaned.toLowerCase().includes(n.label.toLowerCase())
  );
  if (reverseLabel) return reverseLabel.id;

  // 4. Partial ID match
  const partial = nodes.find(
    (n) => n.id.includes(cleanSearch) || cleanSearch.includes(n.id)
  );
  if (partial) return partial.id;

  // 5. Fuzzy: check if any word in the search matches any word in any node label
  const searchWords = cleaned.toLowerCase().split(/\s+/);
  const fuzzy = nodes.find((n) => {
    const labelWords = n.label.toLowerCase().split(/\s+/);
    return searchWords.some((sw) => labelWords.some((lw) => lw.includes(sw) || sw.includes(lw)));
  });
  if (fuzzy) return fuzzy.id;

  return null;
}

function capitalize(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
