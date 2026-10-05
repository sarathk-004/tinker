import type { DiagramEdge, DiagramNode } from '../types/diagram';

/** Pure view animation (play-flow). It only changes highlight/dim styling, never the document. Moved from the prototype store. */
export interface FlowHost {
  getNodes(): DiagramNode[];
  getEdges(): DiagramEdge[];
  setView(patch: { nodes?: DiagramNode[]; edges?: DiagramEdge[]; highlightedIds?: string[]; activeAction?: string | null; isPlayingFlow?: boolean }): void;
  clearHighlight(): void;
}

export function getNodeArchitecturalRank(node?: DiagramNode): number {
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

export async function playFlow(host: FlowHost, sequence?: string[]): Promise<void> {
      const nodes = host.getNodes();
      const edges = host.getEdges();
      if (nodes.length === 0) return;

      host.setView({ isPlayingFlow: true });

      interface FlowStep {
        nodeId: string;
        edgeId?: string;
        label: string;
      }

      const steps: FlowStep[] = [];

      if (sequence && sequence.length > 0) {
        for (let i = 0; i < sequence.length; i++) {
          const nid = sequence[i];
          const prevNid = i > 0 ? sequence[i - 1] : undefined;
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
        host.setView({ isPlayingFlow: false });
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
          const pulseEdges = host.getEdges().map((e) => {
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
          host.setView({ edges: pulseEdges });
          await new Promise((r) => setTimeout(r, 160));
        }

        // Light up node
        const stepNodes = host.getNodes().map((node) => {
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

        const stepEdges = host.getEdges().map((e) => {
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

        host.setView({
          nodes: stepNodes,
          edges: stepEdges,
          highlightedIds: [...activePathSoFar],
          activeAction: actionLabel,
        });

        await new Promise((resolve) => setTimeout(resolve, 440));
      }

      // Hold final complete pipeline illuminated briefly
      await new Promise((resolve) => setTimeout(resolve, 1100));
      host.clearHighlight();
      host.setView({ isPlayingFlow: false });
}
