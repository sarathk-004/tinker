import { AWSServiceIcon, SystemNodeType } from '../types/diagram';

export interface QuickComponent {
  label: string;
  type: SystemNodeType;
  awsIcon: AWSServiceIcon;
  subType?: string;
  category: 'Compute' | 'Networking' | 'Storage & DB' | 'Queues & Events' | 'Security';
}

export const PALETTE: QuickComponent[] = [
  // Compute
  { label: 'EC2 Microservice', type: 'service', awsIcon: 'ec2', subType: 'Amazon EC2', category: 'Compute' },
  { label: 'AWS Lambda', type: 'service', awsIcon: 'lambda', subType: 'AWS Lambda', category: 'Compute' },
  { label: 'Amazon EKS', type: 'service', awsIcon: 'eks', subType: 'Amazon EKS', category: 'Compute' },
  { label: 'Step Functions', type: 'service', awsIcon: 'step-functions', subType: 'AWS Step Functions', category: 'Compute' },

  // Networking
  { label: 'API Gateway', type: 'gateway', awsIcon: 'api-gateway', subType: 'Amazon API Gateway', category: 'Networking' },
  { label: 'App Load Balancer', type: 'gateway', awsIcon: 'alb', subType: 'Application Load Balancer', category: 'Networking' },
  { label: 'CloudFront CDN', type: 'gateway', awsIcon: 'cloudfront', subType: 'Amazon CloudFront', category: 'Networking' },
  { label: 'Route 53 DNS', type: 'gateway', awsIcon: 'route53', subType: 'Amazon Route 53', category: 'Networking' },

  // Storage & DB
  { label: 'PostgreSQL DB', type: 'database', awsIcon: 'rds', subType: 'Amazon RDS (PostgreSQL)', category: 'Storage & DB' },
  { label: 'DynamoDB', type: 'database', awsIcon: 'dynamodb', subType: 'Amazon DynamoDB', category: 'Storage & DB' },
  { label: 'Redis Cache', type: 'cache', awsIcon: 'redis', subType: 'ElastiCache / Redis', category: 'Storage & DB' },
  { label: 'OpenSearch', type: 'database', awsIcon: 'opensearch', subType: 'Amazon OpenSearch', category: 'Storage & DB' },
  { label: 'S3 Storage', type: 'storage', awsIcon: 's3', subType: 'Amazon S3', category: 'Storage & DB' },

  // Queues & Events
  { label: 'SQS Queue', type: 'queue', awsIcon: 'sqs', subType: 'Amazon SQS', category: 'Queues & Events' },
  { label: 'SNS Notifications', type: 'queue', awsIcon: 'sns', subType: 'Amazon SNS', category: 'Queues & Events' },
  { label: 'EventBridge', type: 'queue', awsIcon: 'eventbridge', subType: 'Amazon EventBridge', category: 'Queues & Events' },
  { label: 'Kinesis Stream', type: 'queue', awsIcon: 'kinesis', subType: 'Amazon Kinesis', category: 'Queues & Events' },

  // Security & Client
  { label: 'AWS Cognito', type: 'service', awsIcon: 'cognito', subType: 'AWS Cognito (Auth)', category: 'Security' },
  { label: 'AWS WAF', type: 'gateway', awsIcon: 'waf', subType: 'AWS WAF', category: 'Security' },
  { label: 'Secrets Manager', type: 'service', awsIcon: 'secrets-manager', subType: 'AWS Secrets Manager', category: 'Security' },
  { label: 'Web Client', type: 'client', awsIcon: 'client', subType: 'Web / Mobile Client', category: 'Security' },
];
