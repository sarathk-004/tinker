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

function getNodeArchitecturalRank(node?: DiagramNode): number {
  if (!node) return 99;
  const type = node.data.type;
  const icon = (node.data.awsIcon || '').toLowerCase();
  const label = (node.data.label || '').toLowerCase();

  // 1. Client / Ingress consumer
  if (type === 'client' || label.includes('client') || label.includes('user') || label.includes('browser') || label.includes('mobile')) return 1;
  // 2. DNS & Edge CDN
  if (icon === 'route53' || icon === 'waf' || icon === 'cloudfront') return 2;
  // 3. Reverse Proxies & Gateways
  if (type === 'gateway' || icon === 'api-gateway' || icon === 'alb') return 3;
  // 4. Authentication / Security
  if (icon === 'cognito' || label.includes('auth') || label.includes('jwt') || label.includes('login')) return 4;
  // 5. Compute & Business microservices
  if (type === 'service' || icon === 'lambda' || icon === 'ec2' || icon === 'ecs' || icon === 'eks') return 5;
  // 6. Caching Layer (fast path before DB)
  if (type === 'cache' || icon === 'redis' || icon === 'elasticache') return 6;
  // 7. Relational / Primary DB persistence
  if (type === 'database' || icon === 'rds' || icon === 'dynamodb') return 7;
  // 8. Event Streaming & Buffering Queues
  if (type === 'queue' || icon === 'sqs' || icon === 'sns' || icon === 'eventbridge' || icon === 'kinesis') return 8;
  // 9. Object Storage & Search
  if (type === 'storage' || icon === 's3' || icon === 'opensearch' || icon === 'secrets-manager') return 9;

  return 10;
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

    // Logical packet animation: traces realistic architectural pipeline from Ingress -> Services -> DB/Cache
    playFlow: async (sequence?: string[]) => {
      const nodes = get().nodes;
      const edges = get().edges;
      if (nodes.length === 0) return;

      set({ isPlayingFlow: true });

      interface FlowStep {
        nodeId: string;
        edgeId?: string;
        label: string;
      }

      const steps: FlowStep[] = [];

      if (sequence && sequence.length > 0) {
        for (let i = 0; i < sequence.length; i++) {
          const nid = sanitizeId(sequence[i]);
          const prevNid = i > 0 ? sanitizeId(sequence[i - 1]) : undefined;
          const connectingEdge = prevNid
            ? edges.find(
                (e) => (e.source === prevNid && e.target === nid) || (e.source === nid && e.target === prevNid)
              )
            : undefined;
          const node = nodes.find((n) => n.id === nid);
          if (node) {
            steps.push({
              nodeId: nid,
              edgeId: connectingEdge?.id,
              label: node.data.label || nid,
            });
          }
        }
      } else {
        // Build sequence using architectural logic
        const incomingCount: Record<string, number> = {};
        nodes.forEach((n) => {
          incomingCount[n.id] = 0;
        });
        edges.forEach((e) => {
          if (incomingCount[e.target] !== undefined) incomingCount[e.target]++;
        });

        // Rank roots: in-degree 0 nodes first, sorted by architectural entry rank
        const roots = nodes.filter((n) => incomingCount[n.id] === 0);
        roots.sort((a, b) => getNodeArchitecturalRank(a) - getNodeArchitecturalRank(b));

        const orderedRoots =
          roots.length > 0
            ? roots
            : [...nodes].sort((a, b) => getNodeArchitecturalRank(a) - getNodeArchitecturalRank(b));

        const visitedNodes = new Set<string>();
        const visitedEdges = new Set<string>();

        const traverse = (nodeId: string, fromEdgeId?: string) => {
          if (visitedNodes.has(nodeId)) return;
          visitedNodes.add(nodeId);

          const node = nodes.find((n) => n.id === nodeId);
          if (node) {
            steps.push({
              nodeId,
              edgeId: fromEdgeId,
              label: node.data.label || nodeId,
            });
          }

          // Outgoing edges from this node
          const outgoing = edges.filter((e) => e.source === nodeId && !visitedEdges.has(e.id));
          // Sort outgoing edges by the target node's architectural priority (Auth -> Service -> Cache -> DB -> Queue)
          outgoing.sort((a, b) => {
            const targetA = nodes.find((n) => n.id === a.target);
            const targetB = nodes.find((n) => n.id === b.target);
            return getNodeArchitecturalRank(targetA) - getNodeArchitecturalRank(targetB);
          });

          for (const edge of outgoing) {
            visitedEdges.add(edge.id);
            traverse(edge.target, edge.id);
          }
        };

        orderedRoots.forEach((r) => traverse(r.id));
      }

      if (steps.length === 0) {
        set({ isPlayingFlow: false });
        return;
      }

      // Step-by-step visual animation
      const activePathSoFar: string[] = [];
      const activeEdgesSoFar: string[] = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        activePathSoFar.push(step.nodeId);
        if (step.edgeId) {
          activeEdgesSoFar.push(step.edgeId);
        }

        // Pulse edge first if connecting edge exists
        if (step.edgeId) {
          const pulseEdges = get().edges.map((e) => {
            const isThisEdge = e.id === step.edgeId;
            const isHistorical = activeEdgesSoFar.includes(e.id);
            return {
              ...e,
              animated: true,
              style: {
                ...e.style,
                stroke: isThisEdge ? '#f54e00' : isHistorical ? '#26251e' : '#cfcdc4',
                strokeWidth: isThisEdge ? 3 : isHistorical ? 2 : 1.2,
                opacity: isThisEdge ? 1 : isHistorical ? 0.7 : 0.2,
              },
            };
          });
          set({ edges: pulseEdges });
          await new Promise((r) => setTimeout(r, 160));
        }

        // Light up node
        const stepNodes = get().nodes.map((node) => {
          const isCurrent = node.id === step.nodeId;
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

        const stepEdges = get().edges.map((e) => {
          const isThisEdge = e.id === step.edgeId;
          const isHistorical = activeEdgesSoFar.includes(e.id);
          return {
            ...e,
            animated: true,
            style: {
              ...e.style,
              stroke: isThisEdge ? '#f54e00' : isHistorical ? '#26251e' : '#cfcdc4',
              strokeWidth: isThisEdge ? 3 : isHistorical ? 2 : 1.2,
              opacity: isThisEdge ? 1 : isHistorical ? 0.8 : 0.2,
            },
          };
        });

        const prevLabel = i > 0 ? steps[i - 1].label : '';
        const actionLabel = prevLabel
          ? `Flow: ${prevLabel} ➔ ${step.label}`
          : `Flow Ingress: ${step.label}`;

        set({
          nodes: stepNodes,
          edges: stepEdges,
          highlightedIds: [...activePathSoFar],
          activeAction: actionLabel,
        });

        await new Promise((resolve) => setTimeout(resolve, 440));
      }

      // Hold final complete pipeline illuminated briefly
      await new Promise((resolve) => setTimeout(resolve, 1100));
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
