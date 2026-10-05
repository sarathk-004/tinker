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
  /** From canonical metadata.group; shown as a small tag. */
  group?: string;
  isHighlighted?: boolean;
  isDimmed?: boolean;
}

export type DiagramNode = Node<DiagramNodeData, 'awsNode'>;
export type DiagramEdge = Edge;
