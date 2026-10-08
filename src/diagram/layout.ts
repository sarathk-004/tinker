import dagre from '@dagrejs/dagre';
import { Position } from '@xyflow/react';
import { DiagramNode, DiagramEdge } from '../types/diagram';

// The size of a node card on screen (see AWSArchitectureNode), so that tidying leaves the same gaps the eye expects.
const NODE_WIDTH = 240;
const NODE_HEIGHT = 112;

export function getLayoutedElements(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: 'LR' | 'TB' = 'LR'
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const dagreGraph = new dagre.graphlib.Graph({ multigraph: true });
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: direction === 'LR' ? 60 : 50,
    ranksep: direction === 'LR' ? 100 : 70,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target, {}, edge.id);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes: DiagramNode[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    const x = (nodeWithPosition?.x ?? 0) - NODE_WIDTH / 2;
    const y = (nodeWithPosition?.y ?? 0) - NODE_HEIGHT / 2;

    return {
      ...node,
      targetPosition: direction === 'LR' ? Position.Left : Position.Top,
      sourcePosition: direction === 'LR' ? Position.Right : Position.Bottom,
      position: { x, y },
    };
  });

  return { nodes: layoutedNodes, edges };
}
