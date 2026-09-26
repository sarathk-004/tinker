import { create } from 'zustand';
import { DiagramState, DiagramNode, DiagramEdge, SystemNodeType, AWSServiceIcon } from '../types/diagram';
import { getLayoutedElements } from './layout';
import { MarkerType } from '@xyflow/react';

// Helper to sanitize identifiers from spoken natural language
export function sanitizeId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+(?:in\s+)?between(?:\s+them|\s+the\s+two|\s+both)?.*$/i, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Helper to clean conversational labels (e.g. "Redis between them" -> "Redis")
export function sanitizeLabel(raw: string): string {
  if (!raw) return 'Service';
  const cleaned = raw
    .replace(/\s+(?:in\s+)?between(?:\s+them|\s+the\s+two|\s+both)?.*$/i, '')
    .trim();
  return cleaned.length > 0 ? cleaned : 'Service';
}

// Smart mapper to infer AWS service and node type from conversational names
export function inferAWSDetails(name: string, explicitType?: SystemNodeType): {
  type: SystemNodeType;
  awsIcon: AWSServiceIcon;
  subType: string;
} {
  const cleanName = sanitizeLabel(name);
  const lower = cleanName.toLowerCase();

  if (lower.includes('redis') || lower.includes('cache') || lower.includes('elasticache')) {
    return { type: 'cache', awsIcon: 'redis', subType: 'ElastiCache / Redis' };
  }
  if (lower.includes('postgres') || lower.includes('rds') || lower.includes('mysql') || lower.includes('database') || lower.includes('db')) {
    return { type: 'database', awsIcon: 'rds', subType: 'Amazon RDS' };
  }
  if (lower.includes('dynamo')) {
    return { type: 'database', awsIcon: 'dynamodb', subType: 'DynamoDB' };
  }
  if (lower.includes('gateway') || lower.includes('api')) {
    return { type: 'gateway', awsIcon: 'api-gateway', subType: 'API Gateway' };
  }
  if (lower.includes('balancer') || lower.includes('alb') || lower.includes('elb')) {
    return { type: 'gateway', awsIcon: 'alb', subType: 'Application Load Balancer' };
  }
  if (lower.includes('client') || lower.includes('user') || lower.includes('mobile') || lower.includes('browser') || lower.includes('app')) {
    return { type: 'client', awsIcon: 'client', subType: 'Web / Mobile Client' };
  }
  if (lower.includes('queue') || lower.includes('sqs') || lower.includes('kafka')) {
    return { type: 'queue', awsIcon: 'sqs', subType: 'Amazon SQS' };
  }
  if (lower.includes('s3') || lower.includes('storage') || lower.includes('bucket')) {
    return { type: 'storage', awsIcon: 's3', subType: 'Amazon S3' };
  }
  if (lower.includes('lambda') || lower.includes('serverless')) {
    return { type: 'service', awsIcon: 'lambda', subType: 'AWS Lambda' };
  }
  if (lower.includes('order') || lower.includes('auth') || lower.includes('pay') || lower.includes('service') || lower.includes('ec2') || lower.includes('backend')) {
    return { type: 'service', awsIcon: 'ec2', subType: 'Amazon EC2 / Microservice' };
  }

  const fallbackType = explicitType || 'service';
  return {
    type: fallbackType,
    awsIcon: fallbackType === 'database' ? 'rds' : fallbackType === 'cache' ? 'redis' : 'generic',
    subType: 'Service',
  };
}

export const useDiagramStore = create<DiagramState>((set, get) => {
  const pushHistory = () => {
    const currentSnapshot = {
      nodes: JSON.parse(JSON.stringify(get().nodes)),
      edges: JSON.parse(JSON.stringify(get().edges)),
    };
    set((state) => ({
      history: [...state.history.slice(-30), currentSnapshot],
    }));
  };

  return {
    nodes: [],
    edges: [],
    highlightedIds: [],
    activeAction: null,
    history: [],

    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),

    undo: () => {
      const hist = get().history;
      if (hist.length === 0) return;
      const previous = hist[hist.length - 1];
      const newHist = hist.slice(0, -1);
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        previous.nodes,
        previous.edges
      );
      set({
        nodes: layoutedNodes,
        edges: layoutedEdges,
        history: newHist,
        activeAction: 'Undid previous action',
      });
    },

    addNode: ({ id, label, type, awsIcon, subType, description }) => {
      pushHistory();
      const cleanLabel = sanitizeLabel(label);
    const inferred = inferAWSDetails(cleanLabel, type);
    const resolvedType = type || inferred.type;
    const resolvedIcon = awsIcon || inferred.awsIcon;
    const resolvedSubType = subType || inferred.subType;
    const resolvedId = id ? sanitizeId(id) : sanitizeId(cleanLabel) || `node_${Date.now()}`;

    // Prevent duplicate node addition
    const existing = get().nodes.find((n) => n.id === resolvedId);
    if (existing) {
      // If already exists, just return its id
      return existing.id;
    }

    const newNode: DiagramNode = {
      id: resolvedId,
      type: 'awsNode',
      position: { x: 0, y: 0 },
      data: {
        id: resolvedId,
        label: cleanLabel,
        type: resolvedType,
        awsIcon: resolvedIcon,
        subType: resolvedSubType,
        description,
      },
    };

    const currentNodes = [...get().nodes, newNode];
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      currentNodes,
      get().edges
    );

    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
      activeAction: `Added node: ${cleanLabel}`,
    });

    return resolvedId;
  },

  removeNode: (id: string, options?: { reconnectBridge?: boolean }) => {
    pushHistory();
    const reconnect = options?.reconnectBridge ?? true;
    const targetId = sanitizeId(id);

    // Find all incoming sources and outgoing targets before removing
    const incomingSources = get()
      .edges.filter((e) => e.target === targetId)
      .map((e) => e.source);
    const outgoingTargets = get()
      .edges.filter((e) => e.source === targetId)
      .map((e) => e.target);

    const filteredNodes = get().nodes.filter((n) => n.id !== targetId);
    let filteredEdges = get().edges.filter(
      (e) => e.source !== targetId && e.target !== targetId
    );

    // If node was bridging incoming sources and outgoing targets (e.g. was inserted between them),
    // reconnect the incoming sources to the outgoing targets so connections aren't lost!
    let bridged = false;
    if (reconnect && incomingSources.length > 0 && outgoingTargets.length > 0) {
      incomingSources.forEach((src) => {
        outgoingTargets.forEach((tgt) => {
          if (src !== tgt) {
            const alreadyConnected = filteredEdges.some(
              (e) => e.source === src && e.target === tgt
            );
            if (!alreadyConnected) {
              bridged = true;
              filteredEdges.push({
                id: `e_${src}_${tgt}`,
                source: src,
                target: tgt,
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#FF9900', strokeWidth: 2.2 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 18,
                  height: 18,
                  color: '#FF9900',
                },
              });
            }
          }
        });
      });
    }

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      filteredNodes,
      filteredEdges
    );

    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
      activeAction: `Removed node: ${id}${bridged ? ' (reconnected bridge)' : ''}`,
    });
  },

  connect: (source: string, target: string, label?: string, bidirectional?: boolean) => {
    pushHistory();
    const srcId = sanitizeId(source);
    const tgtId = sanitizeId(target);

    if (srcId === tgtId) return;

    // Check if identical directed edge already exists (same source, target, and label)
    const exists = get().edges.some(
      (e) => e.source === srcId && e.target === tgtId && (e.label || '') === (label || '')
    );
    if (exists) return;

    // Check if there is a reverse edge or existing edge for parallel styling
    const hasReverse = get().edges.some((e) => e.source === tgtId && e.target === srcId);
    const hasParallel = get().edges.some((e) => e.source === srcId && e.target === tgtId);

    const edgeId = label
      ? `e_${srcId}_${tgtId}_${sanitizeId(label)}`
      : hasReverse || hasParallel
      ? `e_${srcId}_${tgtId}_${Date.now()}`
      : `e_${srcId}_${tgtId}`;

    const isBi = Boolean(bidirectional);

    const newEdge: DiagramEdge = {
      id: edgeId,
      source: srcId,
      target: tgtId,
      label,
      type: hasReverse || hasParallel ? 'default' : 'smoothstep',
      animated: true,
      style: { stroke: '#FF9900', strokeWidth: 2.2 },
      ...(isBi
        ? {
            markerStart: {
              type: MarkerType.ArrowClosed,
              width: 18,
              height: 18,
              color: '#FF9900',
            },
          }
        : {}),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#FF9900',
      },
    };

    const currentEdges = [...get().edges, newEdge];
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      get().nodes,
      currentEdges
    );

    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
      activeAction: `Connected: ${source} → ${target}${label ? ` (${label})` : ''}`,
    });
  },

  disconnect: (source: string, target: string) => {
    pushHistory();
    const srcId = sanitizeId(source);
    const tgtId = sanitizeId(target);

    const filteredEdges = get().edges.filter(
      (e) =>
        !(
          (e.source === srcId && e.target === tgtId) ||
          (e.source === tgtId && e.target === srcId)
        )
    );

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      get().nodes,
      filteredEdges
    );

    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
      activeAction: `Disconnected: ${source} ↮ ${target}`,
    });
  },

  renameNode: (id: string, newLabel: string) => {
    pushHistory();
    const targetId = sanitizeId(id);
    const inferred = inferAWSDetails(newLabel);

    const updatedNodes = get().nodes.map((node) => {
      if (node.id === targetId) {
        return {
          ...node,
          data: {
            ...node.data,
            label: newLabel,
            subType: inferred.subType,
            awsIcon: inferred.awsIcon,
          },
        };
      }
      return node;
    });

    set({
      nodes: updatedNodes,
      activeAction: `Renamed ${id} to ${newLabel}`,
    });
  },

  insertBetween: (source: string, target: string, node) => {
    pushHistory();
    const srcId = sanitizeId(source);
    const tgtId = sanitizeId(target);
    const cleanLabel = sanitizeLabel(node.label);
    const inferred = inferAWSDetails(cleanLabel, node.type);
    const newNodeId = node.id ? sanitizeId(node.id) : sanitizeId(cleanLabel) || `node_${Date.now()}`;

    // 1. Remove direct connection between source and target
    const remainingEdges = get().edges.filter(
      (e) =>
        !(
          (e.source === srcId && e.target === tgtId) ||
          (e.source === tgtId && e.target === srcId)
        )
    );

    // 2. Create the new node
    const newNode: DiagramNode = {
      id: newNodeId,
      type: 'awsNode',
      position: { x: 0, y: 0 },
      data: {
        id: newNodeId,
        label: cleanLabel,
        type: node.type || inferred.type,
        awsIcon: node.awsIcon || inferred.awsIcon,
        subType: node.subType || inferred.subType,
      },
    };

    // 3. Create the two new connected edges
    const edge1: DiagramEdge = {
      id: `e_${srcId}_${newNodeId}`,
      source: srcId,
      target: newNodeId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#FF9900', strokeWidth: 2.2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#FF9900',
      },
    };

    const edge2: DiagramEdge = {
      id: `e_${newNodeId}_${tgtId}`,
      source: newNodeId,
      target: tgtId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#FF9900', strokeWidth: 2.2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#FF9900',
      },
    };

    const updatedNodes = [...get().nodes.filter((n) => n.id !== newNodeId), newNode];
    const updatedEdges = [...remainingEdges, edge1, edge2];

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      updatedNodes,
      updatedEdges
    );

    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
      activeAction: `Inserted ${node.label} between ${source} and ${target}`,
    });

    return newNodeId;
  },

  highlight: (ids: string[]) => {
    const cleanIds = ids.map(sanitizeId);
    const updatedNodes = get().nodes.map((node) => {
      const isMatch = cleanIds.includes(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          isHighlighted: isMatch,
          isDimmed: cleanIds.length > 0 && !isMatch,
        },
      };
    });

    const updatedEdges = get().edges.map((edge) => {
      const isConnected = cleanIds.includes(edge.source) && cleanIds.includes(edge.target);
      return {
        ...edge,
        animated: isConnected,
        style: {
          ...edge.style,
          stroke: isConnected ? '#F59E0B' : '#4B5563',
          strokeWidth: isConnected ? 3 : 1.5,
          opacity: cleanIds.length === 0 || isConnected ? 1 : 0.25,
        },
      };
    });

    set({
      nodes: updatedNodes,
      edges: updatedEdges,
      highlightedIds: cleanIds,
      activeAction: `Highlighted: ${ids.join(', ')}`,
    });
  },

  clearHighlight: () => {
    const updatedNodes = get().nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isHighlighted: false,
        isDimmed: false,
      },
    }));

    const updatedEdges = get().edges.map((edge) => ({
      ...edge,
      style: {
        ...edge.style,
        stroke: '#FF9900',
        strokeWidth: 2.2,
        opacity: 1,
      },
    }));

    set({
      nodes: updatedNodes,
      edges: updatedEdges,
      highlightedIds: [],
    });
  },

  reset: () => {
    pushHistory();
    set({
      nodes: [],
      edges: [],
      highlightedIds: [],
      activeAction: 'Reset canvas',
    });
  },

  applyLayout: (direction = 'LR') => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      get().nodes,
      get().edges,
      direction
    );
    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
    });
  },
};
});
