import { Node, Edge } from '@xyflow/react';

export type SystemNodeType =
  | 'client'
  | 'gateway'
  | 'service'
  | 'database'
  | 'cache'
  | 'queue'
  | 'storage'
  | 'external'
  | 'generic';

export type AWSServiceIcon =
  | 'client'
  | 'api-gateway'
  | 'alb'
  | 'ec2'
  | 'lambda'
  | 'ecs'
  | 'eks'
  | 'rds'
  | 'dynamodb'
  | 'elasticache'
  | 'redis'
  | 'sqs'
  | 'sns'
  | 's3'
  | 'cloudfront'
  | 'cognito'
  | 'route53'
  | 'waf'
  | 'eventbridge'
  | 'kinesis'
  | 'opensearch'
  | 'secrets-manager'
  | 'step-functions'
  | 'generic';

export interface DiagramNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: SystemNodeType;
  awsIcon?: AWSServiceIcon;
  subType?: string;
  description?: string;
  isHighlighted?: boolean;
  isDimmed?: boolean;
}

export type DiagramNode = Node<DiagramNodeData, 'awsNode'>;
export type DiagramEdge = Edge;

export interface DiagramState {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  highlightedIds: string[];
  selectedNodeIds: string[];
  activeAction: string | null;
  isPlayingFlow: boolean;

  history: Array<{ nodes: DiagramNode[]; edges: DiagramEdge[] }>;

  // Actions
  addNode: (node: {
    id?: string;
    label: string;
    type?: SystemNodeType;
    awsIcon?: AWSServiceIcon;
    subType?: string;
    description?: string;
  }) => string;
  removeNode: (id: string, options?: { reconnectBridge?: boolean }) => void;
  deleteSelected: () => void;
  setSelectedNodeIds: (ids: string[]) => void;
  connect: (source: string, target: string, label?: string, bidirectional?: boolean) => void;
  disconnect: (source: string, target: string) => void;
  renameNode: (id: string, newLabel: string) => void;
  updateNode: (id: string, updates: Partial<DiagramNodeData>) => void;
  insertBetween: (
    source: string,
    target: string,
    node: {
      id?: string;
      label: string;
      type?: SystemNodeType;
      awsIcon?: AWSServiceIcon;
      subType?: string;
    }
  ) => string;
  highlight: (ids: string[]) => void;
  clearHighlight: () => void;
  playFlow: (sequence?: string[]) => Promise<void>;
  reset: () => void;
  undo: () => void;
  groupNodes: (ids: string[], groupName: string) => void;
  applyLayout: (direction?: 'LR' | 'TB') => void;
  setNodes: (nodes: DiagramNode[]) => void;
  setEdges: (edges: DiagramEdge[]) => void;
}
