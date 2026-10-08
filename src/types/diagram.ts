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

/** The icon key of a catalog service (see src/catalog/services.ts), 'client' or 'generic'. */
export type AWSServiceIcon = string;

export interface DiagramNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: SystemNodeType;
  awsIcon?: AWSServiceIcon;
  subType?: string;
  description?: string;
  /** From canonical metadata.group; shown as a small tag. */
  group?: string;
  isHighlighted?: boolean;
  isDimmed?: boolean;
}

export type DiagramNode = Node<DiagramNodeData, 'awsNode'>;
export type DiagramEdge = Edge;
