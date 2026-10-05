import type { AWSServiceIcon, SystemNodeType } from '../types/diagram';

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
