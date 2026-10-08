import type { SystemNodeType } from '../types/diagram';

/**
 * Every component Tinker can place, with plain words for what it does ("monitoring", "queue", "encryption") so it can be found by
 * purpose and not only by name. `id` is also the icon key. Services without an official AWS icon in the app get a coloured badge.
 */
export const CATEGORIES = [
  'Compute',
  'Containers',
  'Networking & CDN',
  'Storage',
  'Databases',
  'Analytics',
  'Integration & Messaging',
  'Security & Identity',
  'Monitoring & Management',
  'Developer Tools',
  'AI & Machine Learning',
  'Clients & External',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface CatalogService {
  id: string;
  label: string;
  subType: string;
  type: SystemNodeType;
  category: Category;
  /** What it is for, in everyday words. Searched, never shown. */
  keywords: string;
}

type Row = [id: string, label: string, subType: string, type: SystemNodeType, category: Category, keywords: string];

const ROWS: Row[] = [
  // Compute
  ['ec2', 'EC2 Instance', 'Amazon EC2', 'service', 'Compute', 'virtual machine server vm instance hosting backend microservice compute'],
  ['lambda', 'AWS Lambda', 'AWS Lambda', 'service', 'Compute', 'serverless function event driven compute code without servers'],
  ['elastic-beanstalk', 'Elastic Beanstalk', 'AWS Elastic Beanstalk', 'service', 'Compute', 'platform deploy web app hosting managed'],
  ['lightsail', 'Lightsail', 'Amazon Lightsail', 'service', 'Compute', 'simple vps virtual server small hosting'],
  ['batch', 'AWS Batch', 'AWS Batch', 'service', 'Compute', 'batch jobs processing scheduled compute workers'],
  ['autoscaling', 'Auto Scaling', 'Amazon EC2 Auto Scaling', 'service', 'Compute', 'scale scaling capacity elastic fleet'],
  ['apprunner', 'App Runner', 'AWS App Runner', 'service', 'Compute', 'containers web service deploy managed'],
  // Containers
  ['ecs', 'Amazon ECS', 'Amazon ECS', 'service', 'Containers', 'containers docker orchestration cluster tasks'],
  ['eks', 'Amazon EKS', 'Amazon EKS (Kubernetes)', 'service', 'Containers', 'kubernetes k8s containers orchestration cluster'],
  ['fargate', 'AWS Fargate', 'AWS Fargate', 'service', 'Containers', 'serverless containers docker without servers'],
  ['ecr', 'Container Registry', 'Amazon ECR', 'storage', 'Containers', 'docker images registry repository containers'],
  // Networking & CDN
  ['api-gateway', 'API Gateway', 'Amazon API Gateway', 'gateway', 'Networking & CDN', 'api rest http websocket entry point routing throttling'],
  ['alb', 'App Load Balancer', 'Application Load Balancer', 'gateway', 'Networking & CDN', 'load balancer traffic distribute http layer 7 availability'],
  ['elb', 'Network Load Balancer', 'Elastic Load Balancing', 'gateway', 'Networking & CDN', 'load balancer tcp traffic distribute layer 4 availability'],
  ['cloudfront', 'CloudFront CDN', 'Amazon CloudFront', 'gateway', 'Networking & CDN', 'cdn content delivery edge cache static fast global'],
  ['route53', 'Route 53 DNS', 'Amazon Route 53', 'gateway', 'Networking & CDN', 'dns domain name routing failover'],
  ['vpc', 'VPC', 'Amazon VPC', 'gateway', 'Networking & CDN', 'virtual private network subnet isolation private network security'],
  ['app-mesh', 'App Mesh', 'AWS App Mesh', 'gateway', 'Networking & CDN', 'service mesh microservices traffic observability'],
  ['directconnect', 'Direct Connect', 'AWS Direct Connect', 'gateway', 'Networking & CDN', 'dedicated connection on premises hybrid network'],
  ['nat', 'NAT Gateway', 'NAT Gateway', 'gateway', 'Networking & CDN', 'outbound internet private subnet network address translation'],
  // Storage
  ['s3', 'Amazon S3', 'Amazon S3', 'storage', 'Storage', 'bucket object storage files images upload static assets backup'],
  ['glacier', 'S3 Glacier', 'Amazon S3 Glacier', 'storage', 'Storage', 'archive cold storage long term backup cheap'],
  ['efs', 'EFS File System', 'Amazon EFS', 'storage', 'Storage', 'shared file system nfs files network drive'],
  ['ebs', 'EBS Volume', 'Amazon EBS', 'storage', 'Storage', 'block storage disk volume drive'],
  ['backup', 'AWS Backup', 'AWS Backup', 'storage', 'Storage', 'backup restore recovery disaster protection'],
  // Databases
  ['rds', 'Amazon RDS', 'Amazon RDS (PostgreSQL)', 'database', 'Databases', 'relational sql postgres postgresql mysql database tables transactions'],
  ['aurora', 'Amazon Aurora', 'Amazon Aurora', 'database', 'Databases', 'relational sql mysql postgres database high performance'],
  ['dynamodb', 'DynamoDB', 'Amazon DynamoDB', 'database', 'Databases', 'nosql key value document database serverless fast scale'],
  ['documentdb', 'DocumentDB', 'Amazon DocumentDB', 'database', 'Databases', 'mongodb document nosql json database'],
  ['elasticache', 'ElastiCache', 'Amazon ElastiCache', 'cache', 'Databases', 'cache in memory fast memcached redis speed'],
  ['redis', 'Redis Cache', 'ElastiCache / Redis', 'cache', 'Databases', 'cache in memory fast sessions leaderboard speed key value'],
  ['neptune', 'Neptune', 'Amazon Neptune', 'database', 'Databases', 'graph database relationships social network'],
  ['keyspaces', 'Keyspaces', 'Amazon Keyspaces', 'database', 'Databases', 'cassandra wide column nosql database'],
  ['timestream', 'Timestream', 'Amazon Timestream', 'database', 'Databases', 'time series metrics iot database'],
  ['redshift', 'Redshift', 'Amazon Redshift', 'database', 'Databases', 'data warehouse analytics reporting sql bi'],
  ['opensearch', 'OpenSearch', 'Amazon OpenSearch', 'database', 'Databases', 'search full text elasticsearch logs index analytics'],
  ['cloudsearch', 'CloudSearch', 'Amazon CloudSearch', 'database', 'Databases', 'search full text index'],
  // Analytics
  ['athena', 'Athena', 'Amazon Athena', 'service', 'Analytics', 'query sql data lake s3 analytics serverless'],
  ['glue', 'AWS Glue', 'AWS Glue', 'service', 'Analytics', 'etl data catalog transform pipeline integration'],
  ['lake-formation', 'Lake Formation', 'AWS Lake Formation', 'service', 'Analytics', 'data lake governance access analytics'],
  ['quicksight', 'QuickSight', 'Amazon QuickSight', 'service', 'Analytics', 'dashboards bi reports visualization business intelligence'],
  ['msk', 'Managed Kafka (MSK)', 'Amazon MSK', 'queue', 'Analytics', 'kafka streaming events data pipeline messaging'],
  ['emr', 'EMR', 'Amazon EMR', 'service', 'Analytics', 'big data spark hadoop processing cluster'],
  // Integration & Messaging
  ['sqs', 'SQS Queue', 'Amazon SQS', 'queue', 'Integration & Messaging', 'queue messages async decouple buffer worker background jobs'],
  ['sns', 'SNS Notifications', 'Amazon SNS', 'queue', 'Integration & Messaging', 'notifications pub sub publish subscribe fan out push email sms topic'],
  ['eventbridge', 'EventBridge', 'Amazon EventBridge', 'queue', 'Integration & Messaging', 'events event bus rules schedule integration routing'],
  ['kinesis', 'Kinesis Stream', 'Amazon Kinesis', 'queue', 'Integration & Messaging', 'streaming real time data events ingest analytics'],
  ['mq', 'Amazon MQ', 'Amazon MQ', 'queue', 'Integration & Messaging', 'message broker rabbitmq activemq queue'],
  ['step-functions', 'Step Functions', 'AWS Step Functions', 'service', 'Integration & Messaging', 'workflow orchestration state machine steps process'],
  ['appsync', 'AppSync', 'AWS AppSync', 'gateway', 'Integration & Messaging', 'graphql api realtime subscriptions'],
  ['appflow', 'AppFlow', 'Amazon AppFlow', 'service', 'Integration & Messaging', 'saas integration data transfer salesforce'],
  ['ses', 'Email (SES)', 'Amazon SES', 'service', 'Integration & Messaging', 'email send transactional notifications mail'],
  ['kafka', 'Apache Kafka', 'Apache Kafka', 'queue', 'Integration & Messaging', 'streaming events log messaging broker'],
  // Security & Identity
  ['cognito', 'AWS Cognito', 'AWS Cognito (Auth)', 'service', 'Security & Identity', 'authentication login sign in users identity oauth sso security'],
  ['iam', 'IAM', 'AWS IAM', 'service', 'Security & Identity', 'permissions roles policies access identity security'],
  ['waf', 'AWS WAF', 'AWS WAF', 'gateway', 'Security & Identity', 'firewall web attacks protection security filter'],
  ['shield', 'AWS Shield', 'AWS Shield', 'gateway', 'Security & Identity', 'ddos protection attacks security'],
  ['kms', 'KMS', 'AWS KMS', 'service', 'Security & Identity', 'encryption keys cryptography security'],
  ['secrets-manager', 'Secrets Manager', 'AWS Secrets Manager', 'service', 'Security & Identity', 'secrets passwords credentials api keys rotation security'],
  ['certificate-manager', 'Certificate Manager', 'AWS Certificate Manager', 'service', 'Security & Identity', 'ssl tls https certificates security'],
  ['guardduty', 'GuardDuty', 'Amazon GuardDuty', 'service', 'Security & Identity', 'threat detection security monitoring malicious'],
  ['inspector', 'Inspector', 'Amazon Inspector', 'service', 'Security & Identity', 'vulnerability scanning security compliance'],
  ['macie', 'Macie', 'Amazon Macie', 'service', 'Security & Identity', 'sensitive data pii discovery security privacy'],
  ['securityhub', 'Security Hub', 'AWS Security Hub', 'service', 'Security & Identity', 'security findings compliance overview posture'],
  // Monitoring & Management
  ['cloudwatch', 'CloudWatch', 'Amazon CloudWatch', 'service', 'Monitoring & Management', 'monitoring metrics logs alarms alerts observability dashboards'],
  ['xray', 'X-Ray', 'AWS X-Ray', 'service', 'Monitoring & Management', 'tracing distributed debugging performance observability monitoring'],
  ['cloudtrail', 'CloudTrail', 'AWS CloudTrail', 'service', 'Monitoring & Management', 'audit logging api calls compliance governance security'],
  ['config', 'AWS Config', 'AWS Config', 'service', 'Monitoring & Management', 'configuration compliance tracking governance audit'],
  ['systems-manager', 'Systems Manager', 'AWS Systems Manager', 'service', 'Monitoring & Management', 'operations patching parameters management automation'],
  ['cloudformation', 'CloudFormation', 'AWS CloudFormation', 'service', 'Monitoring & Management', 'infrastructure as code templates provisioning iac'],
  ['opsworks', 'OpsWorks', 'AWS OpsWorks', 'service', 'Monitoring & Management', 'configuration management chef puppet automation'],
  ['prometheus', 'Prometheus', 'Prometheus', 'service', 'Monitoring & Management', 'monitoring metrics alerting observability'],
  ['grafana', 'Grafana', 'Grafana', 'service', 'Monitoring & Management', 'dashboards monitoring metrics visualization observability'],
  // Developer Tools
  ['codecommit', 'CodeCommit', 'AWS CodeCommit', 'service', 'Developer Tools', 'git repository source code version control'],
  ['codebuild', 'CodeBuild', 'AWS CodeBuild', 'service', 'Developer Tools', 'build compile test ci continuous integration'],
  ['codedeploy', 'CodeDeploy', 'AWS CodeDeploy', 'service', 'Developer Tools', 'deploy releases rollout cd continuous delivery'],
  ['codepipeline', 'CodePipeline', 'AWS CodePipeline', 'service', 'Developer Tools', 'ci cd pipeline release automation continuous delivery'],
  ['amplify', 'Amplify', 'AWS Amplify', 'service', 'Developer Tools', 'frontend hosting mobile web app full stack deploy'],
  ['github', 'GitHub Actions', 'GitHub Actions', 'service', 'Developer Tools', 'ci cd pipeline source repository automation'],
  // AI & Machine Learning
  ['sagemaker', 'SageMaker', 'Amazon SageMaker', 'service', 'AI & Machine Learning', 'machine learning ml model training inference ai'],
  ['bedrock', 'Bedrock', 'Amazon Bedrock', 'service', 'AI & Machine Learning', 'generative ai llm foundation models chatbot'],
  ['rekognition', 'Rekognition', 'Amazon Rekognition', 'service', 'AI & Machine Learning', 'image video recognition faces objects vision ai'],
  ['textract', 'Textract', 'Amazon Textract', 'service', 'AI & Machine Learning', 'ocr documents text extraction scan ai'],
  ['comprehend', 'Comprehend', 'Amazon Comprehend', 'service', 'AI & Machine Learning', 'nlp text analysis sentiment language ai'],
  ['translate', 'Translate', 'Amazon Translate', 'service', 'AI & Machine Learning', 'language translation localization ai'],
  ['polly', 'Polly', 'Amazon Polly', 'service', 'AI & Machine Learning', 'text to speech voice audio ai'],
  ['transcribe', 'Transcribe', 'Amazon Transcribe', 'service', 'AI & Machine Learning', 'speech to text audio transcription ai'],
  ['lex', 'Lex', 'Amazon Lex', 'service', 'AI & Machine Learning', 'chatbot conversational voice assistant ai'],
  // Clients & External
  ['client', 'Web Client', 'Web / Mobile Client', 'client', 'Clients & External', 'browser website app mobile user frontend customer'],
  ['mobile', 'Mobile App', 'Mobile Application', 'client', 'Clients & External', 'ios android phone app user customer'],
  ['thirdparty', 'Third-party API', 'External service', 'external', 'Clients & External', 'external vendor partner payment stripe saas integration outside'],
  ['onprem', 'On-premises System', 'On-premises', 'external', 'Clients & External', 'datacenter legacy hybrid existing internal system'],
  ['generic', 'Generic Service', 'Service', 'service', 'Clients & External', 'service component box anything custom'],
];

export const CATALOG: readonly CatalogService[] = ROWS.map(([id, label, subType, type, category, keywords]) => ({ id, label, subType, type, category, keywords }));

const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
export const catalogEntry = (id: string): CatalogService | undefined => BY_ID.get(id);
export const isKnownIcon = (id: string): boolean => BY_ID.has(id);

/** The badge colour of a category, used for services that have no official icon. */
export const CATEGORY_COLOR: Record<Category, string> = {
  Compute: '#ED7100',
  Containers: '#ED7100',
  'Networking & CDN': '#8C4FFF',
  Storage: '#7AA116',
  Databases: '#3B48CC',
  Analytics: '#8C4FFF',
  'Integration & Messaging': '#E7157B',
  'Security & Identity': '#DD344C',
  'Monitoring & Management': '#E7157B',
  'Developer Tools': '#3B48CC',
  'AI & Machine Learning': '#01A88D',
  'Clients & External': '#0EA5E9',
};
