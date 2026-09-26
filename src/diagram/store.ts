import { create } from 'zustand';
import { DiagramState, DiagramNode, DiagramEdge, SystemNodeType, AWSServiceIcon, DiagramNodeData } from '../types/diagram';
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
  if (lower.includes('opensearch') || lower.includes('elasticsearch') || lower.includes('search')) {
    return { type: 'database', awsIcon: 'opensearch', subType: 'Amazon OpenSearch' };
  }
  if (lower.includes('gateway') || lower.includes('api')) {
    return { type: 'gateway', awsIcon: 'api-gateway', subType: 'Amazon API Gateway' };
  }
  if (lower.includes('balancer') || lower.includes('alb') || lower.includes('elb')) {
    return { type: 'gateway', awsIcon: 'alb', subType: 'Application Load Balancer' };
  }
  if (lower.includes('route53') || lower.includes('dns')) {
    return { type: 'gateway', awsIcon: 'route53', subType: 'Amazon Route 53' };
  }
  if (lower.includes('waf') || lower.includes('firewall')) {
    return { type: 'gateway', awsIcon: 'waf', subType: 'AWS WAF' };
  }
  if (lower.includes('cloudfront') || lower.includes('cdn')) {
    return { type: 'gateway', awsIcon: 'cloudfront', subType: 'Amazon CloudFront' };
  }
  if (lower.includes('cognito') || lower.includes('auth')) {
    return { type: 'service', awsIcon: 'cognito', subType: 'AWS Cognito / Auth' };
  }
  if (lower.includes('client') || lower.includes('user') || lower.includes('mobile') || lower.includes('browser') || lower.includes('app')) {
    return { type: 'client', awsIcon: 'client', subType: 'Web / Mobile Client' };
  }
  if (lower.includes('sqs')) {
    return { type: 'queue', awsIcon: 'sqs', subType: 'Amazon SQS' };
  }
  if (lower.includes('sns') || lower.includes('notification')) {
    return { type: 'queue', awsIcon: 'sns', subType: 'Amazon SNS' };
  }
  if (lower.includes('eventbridge') || lower.includes('event bus')) {
    return { type: 'queue', awsIcon: 'eventbridge', subType: 'Amazon EventBridge' };
  }
  if (lower.includes('kinesis') || lower.includes('stream') || lower.includes('kafka')) {
    return { type: 'queue', awsIcon: 'kinesis', subType: 'Amazon Kinesis' };
  }
  if (lower.includes('s3') || lower.includes('storage') || lower.includes('bucket')) {
    return { type: 'storage', awsIcon: 's3', subType: 'Amazon S3' };
  }
  if (lower.includes('lambda') || lower.includes('serverless')) {
    return { type: 'service', awsIcon: 'lambda', subType: 'AWS Lambda' };
  }
  if (lower.includes('eks') || lower.includes('kubernetes') || lower.includes('k8s')) {
    return { type: 'service', awsIcon: 'eks', subType: 'Amazon EKS' };
  }
  if (lower.includes('step') || lower.includes('workflow') || lower.includes('state machine')) {
    return { type: 'service', awsIcon: 'step-functions', subType: 'AWS Step Functions' };
  }
  if (lower.includes('secret') || lower.includes('kms')) {
    return { type: 'service', awsIcon: 'secrets-manager', subType: 'AWS Secrets Manager' };
  }
  if (lower.includes('order') || lower.includes('pay') || lower.includes('service') || lower.includes('ec2') || lower.includes('backend')) {
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
    selectedNodeIds: [],
    activeAction: null,
    isPlayingFlow: false,
    history: [],

    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),
    setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),

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

    addNode: (node) => {
      pushHistory();
      const cleanLabel = sanitizeLabel(node.label);
      const inferred = inferAWSDetails(cleanLabel, node.type);
      const id = node.id ? sanitizeId(node.id) : sanitizeId(cleanLabel) || `node_${Date.now()}`;

      // Check if node with this ID already exists
      const existing = get().nodes.find((n) => n.id === id);
      if (existing) {
        return existing.id;
      }

      const newNode: DiagramNode = {
        id,
        type: 'awsNode',
        position: { x: 0, y: 0 },
        data: {
          id,
          label: cleanLabel,
          type: node.type || inferred.type,
          awsIcon: node.awsIcon || inferred.awsIcon,
          subType: node.subType || inferred.subType,
          description: node.description,
        },
      };

      const updatedNodes = [...get().nodes, newNode];
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        updatedNodes,
        get().edges
      );

      set({
        nodes: layoutedNodes,
        edges: layoutedEdges,
        activeAction: `Added ${cleanLabel}`,
      });

      return id;
    },

    removeNode: (id: string, options?: { reconnectBridge?: boolean }) => {
      pushHistory();
      const targetId = sanitizeId(id);

      const incomingEdges = get().edges.filter((e) => e.target === targetId);
      const outgoingEdges = get().edges.filter((e) => e.source === targetId);

      const filteredNodes = get().nodes.filter((n) => n.id !== targetId);
      const filteredEdges = get().edges.filter(
        (e) => e.source !== targetId && e.target !== targetId
      );

      let bridged = false;
      if (options?.reconnectBridge !== false && incomingEdges.length > 0 && outgoingEdges.length > 0) {
        incomingEdges.forEach((inEdge) => {
          outgoingEdges.forEach((outEdge) => {
            const src = inEdge.source;
            const tgt = outEdge.target;
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
                  style: { stroke: '#26251e', strokeWidth: 1.8 },
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 16,
                    height: 16,
                    color: '#26251e',
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
        selectedNodeIds: get().selectedNodeIds.filter((nid) => nid !== targetId),
        activeAction: `Removed node: ${id}${bridged ? ' (reconnected bridge)' : ''}`,
      });
    },

    deleteSelected: () => {
      const selected = get().selectedNodeIds;
      if (selected.length === 0) {
        // Fallback: if user has a selected node in ReactFlow
        const selFromNodes = get().nodes.filter((n) => n.selected).map((n) => n.id);
        if (selFromNodes.length > 0) {
          selFromNodes.forEach((id) => get().removeNode(id));
        }
        return;
      }
      pushHistory();
      selected.forEach((id) => {
        get().removeNode(id);
      });
      set({ selectedNodeIds: [] });
    },

    updateNode: (id: string, updates: Partial<DiagramNodeData>) => {
      pushHistory();
      const targetId = sanitizeId(id);
      const updatedNodes = get().nodes.map((node) => {
        if (node.id === targetId) {
          return {
            ...node,
            data: {
              ...node.data,
              ...updates,
            },
          };
        }
        return node;
      });

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        updatedNodes,
        get().edges
      );

      set({
        nodes: layoutedNodes,
        edges: layoutedEdges,
        activeAction: `Updated ${updates.label || id}`,
      });
    },

    connect: (source: string, target: string, label?: string, bidirectional?: boolean) => {
      pushHistory();
      const srcId = sanitizeId(source);
      const tgtId = sanitizeId(target);

      if (srcId === tgtId) return;

      const exists = get().edges.some(
        (e) => e.source === srcId && e.target === tgtId && (e.label || '') === (label || '')
      );
      if (exists) return;

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
        style: { stroke: '#26251e', strokeWidth: 1.8 },
        ...(isBi
          ? {
              markerStart: {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                color: '#26251e',
              },
            }
          : {}),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: '#26251e',
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
        activeAction: `Connected ${srcId} → ${tgtId}${isBi ? ' (bidirectional)' : ''}`,
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
        activeAction: `Disconnected ${srcId} - ${tgtId}`,
      });
    },

    renameNode: (id: string, newLabel: string) => {
      pushHistory();
      const targetId = sanitizeId(id);
      const cleanLabel = sanitizeLabel(newLabel);
      const inferred = inferAWSDetails(cleanLabel);

      const updatedNodes = get().nodes.map((node) => {
        if (node.id === targetId) {
          return {
            ...node,
            data: {
              ...node.data,
              label: cleanLabel,
              awsIcon: inferred.awsIcon,
              subType: inferred.subType,
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

      const remainingEdges = get().edges.filter(
        (e) =>
          !(
            (e.source === srcId && e.target === tgtId) ||
            (e.source === tgtId && e.target === srcId)
          )
      );

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

      const edge1: DiagramEdge = {
        id: `e_${srcId}_${newNodeId}`,
        source: srcId,
        target: newNodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#26251e', strokeWidth: 1.8 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: '#26251e',
        },
      };

      const edge2: DiagramEdge = {
        id: `e_${newNodeId}_${tgtId}`,
        source: newNodeId,
        target: tgtId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#26251e', strokeWidth: 1.8 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: '#26251e',
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
            stroke: isConnected ? '#f54e00' : '#cfcdc4',
            strokeWidth: isConnected ? 2.5 : 1.5,
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
          stroke: '#26251e',
          strokeWidth: 1.8,
          opacity: 1,
        },
      }));

      set({
        nodes: updatedNodes,
        edges: updatedEdges,
        highlightedIds: [],
      });
    },

    // Step-by-step packet animation: lights up nodes one after the other across the flow
    playFlow: async (sequence?: string[]) => {
      const nodes = get().nodes;
      const edges = get().edges;
      if (nodes.length === 0) return;

      set({ isPlayingFlow: true });

      // Determine traversal sequence
      let order: string[] = [];
      if (sequence && sequence.length > 0) {
        order = sequence.map(sanitizeId);
      } else {
        // Build sequence starting from root nodes (nodes with 0 incoming edges)
        const incomingCount: Record<string, number> = {};
        nodes.forEach((n) => {
          incomingCount[n.id] = 0;
        });
        edges.forEach((e) => {
          if (incomingCount[e.target] !== undefined) incomingCount[e.target]++;
        });

        const roots = nodes.filter((n) => incomingCount[n.id] === 0).map((n) => n.id);
        const queue = roots.length > 0 ? [...roots] : [nodes[0].id];
        const visited = new Set<string>();

        while (queue.length > 0) {
          const curr = queue.shift()!;
          if (!visited.has(curr)) {
            visited.add(curr);
            order.push(curr);
            const nextNodes = edges.filter((e) => e.source === curr).map((e) => e.target);
            queue.push(...nextNodes);
          }
        }
      }

      // Step-by-step sequential illumination
      for (let i = 0; i < order.length; i++) {
        const activeNodeId = order[i];
        const activePathSoFar = order.slice(0, i + 1);

        const stepNodes = get().nodes.map((node) => {
          const isCurrent = node.id === activeNodeId;
          const isPassed = activePathSoFar.includes(node.id);
          return {
            ...node,
            data: {
              ...node.data,
              isHighlighted: isCurrent || isPassed,
              isDimmed: !isPassed,
            },
          };
        });

        const stepEdges = get().edges.map((edge) => {
          const isTraversed =
            activePathSoFar.includes(edge.source) && activePathSoFar.includes(edge.target);
          return {
            ...edge,
            animated: isTraversed,
            style: {
              ...edge.style,
              stroke: isTraversed ? '#f54e00' : '#cfcdc4',
              strokeWidth: isTraversed ? 2.5 : 1.5,
              opacity: isTraversed ? 1 : 0.25,
            },
          };
        });

        set({
          nodes: stepNodes,
          edges: stepEdges,
          highlightedIds: activePathSoFar,
          activeAction: `Flow step ${i + 1}/${order.length}: ${activeNodeId}`,
        });

        await new Promise((resolve) => setTimeout(resolve, 550));
      }

      // Hold final state briefly, then return to normal
      await new Promise((resolve) => setTimeout(resolve, 900));
      get().clearHighlight();
      set({ isPlayingFlow: false });
    },

    groupNodes: (ids: string[], groupName: string) => {
      pushHistory();
      const cleanIds = ids.map(sanitizeId);
      const updatedNodes = get().nodes.map((node) => {
        if (cleanIds.includes(node.id)) {
          return {
            ...node,
            data: {
              ...node.data,
              subType: groupName,
            },
          };
        }
        return node;
      });

      set({
        nodes: updatedNodes,
        activeAction: `Grouped [${cleanIds.join(', ')}] as "${groupName}"`,
      });
    },

    reset: () => {
      pushHistory();
      set({
        nodes: [],
        edges: [],
        highlightedIds: [],
        selectedNodeIds: [],
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
