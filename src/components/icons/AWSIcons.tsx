import React, { useState } from 'react';
import { Icon } from '@iconify/react';
import { AWSServiceIcon, SystemNodeType } from '../../types/diagram';

interface AWSIconProps {
  name?: AWSServiceIcon;
  type?: SystemNodeType;
  className?: string;
  size?: number;
}

const ICONIFY_AWS_MAP: Record<string, string> = {
  'api-gateway': 'logos:aws-api-gateway',
  'alb': 'logos:aws-elastic-load-balancing',
  'ec2': 'logos:aws-ec2',
  'ecs': 'logos:aws-ecs',
  'eks': 'logos:aws-eks',
  'lambda': 'logos:aws-lambda',
  'rds': 'logos:aws-rds',
  'dynamodb': 'logos:aws-dynamodb',
  'elasticache': 'logos:aws-elasticache',
  'redis': 'logos:redis',
  'sqs': 'logos:aws-sqs',
  'sns': 'logos:aws-sns',
  's3': 'logos:aws-s3',
  'cloudfront': 'logos:aws-cloudfront',
  'cognito': 'logos:aws-cognito',
  'route53': 'logos:aws-route53',
  'waf': 'logos:aws-waf',
  'eventbridge': 'logos:aws-eventbridge',
  'kinesis': 'logos:aws-kinesis',
  'opensearch': 'logos:aws-opensearch',
  'secrets-manager': 'logos:aws-secrets-manager',
  'step-functions': 'logos:aws-step-functions',
};

export const AWSIcon: React.FC<AWSIconProps> = ({
  name,
  type,
  className = 'w-6 h-6',
  size = 26,
}) => {
  const [loadError, setLoadError] = useState(false);
  const resolvedName = name || mapTypeToIcon(type);
  const iconifyId = ICONIFY_AWS_MAP[resolvedName];

  // If Iconify icon exists and hasn't failed to load, render Iconify component
  if (iconifyId && !loadError) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <Icon
          icon={iconifyId}
          width={size}
          height={size}
          onError={() => setLoadError(true)}
        />
      </div>
    );
  }

  // High-fidelity fallback SVG icons
  switch (resolvedName) {
    case 'api-gateway':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#8C4FFF" fillOpacity="0.15" />
          <path d="M12 4L4 8.5L12 13L20 8.5L12 4Z" stroke="#A855F7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 12.5L12 17L20 12.5" stroke="#C084FC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15.5L12 20L20 15.5" stroke="#E9D5FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'alb':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#8C4FFF" fillOpacity="0.15" />
          <circle cx="12" cy="7" r="3" stroke="#A855F7" strokeWidth="1.8" />
          <circle cx="7" cy="17" r="2.5" stroke="#C084FC" strokeWidth="1.8" />
          <circle cx="17" cy="17" r="2.5" stroke="#C084FC" strokeWidth="1.8" />
          <path d="M12 10V13M12 13L8.5 15M12 13L15.5 15" stroke="#A855F7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'ec2':
    case 'ecs':
    case 'eks':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#FF9900" fillOpacity="0.15" />
          <rect x="5" y="5" width="14" height="14" rx="2" stroke="#FF9900" strokeWidth="1.8" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" stroke="#FFB84D" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="12" r="2.5" fill="#FF9900" />
        </svg>
      );

    case 'lambda':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#FF9900" fillOpacity="0.15" />
          <path d="M7 19L11.5 6H13.5L18 19" stroke="#FF9900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 15H16" stroke="#FFB84D" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'rds':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#3B82F6" fillOpacity="0.15" />
          <ellipse cx="12" cy="6" rx="7" ry="2.5" stroke="#3B82F6" strokeWidth="1.8" />
          <path d="M5 6v6c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6" stroke="#60A5FA" strokeWidth="1.8" />
          <path d="M5 12v6c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-6" stroke="#93C5FD" strokeWidth="1.8" />
        </svg>
      );

    case 'dynamodb':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#3B82F6" fillOpacity="0.15" />
          <rect x="5" y="4" width="14" height="5" rx="1.5" stroke="#3B82F6" strokeWidth="1.8" />
          <rect x="5" y="10" width="14" height="5" rx="1.5" stroke="#60A5FA" strokeWidth="1.8" />
          <rect x="5" y="16" width="14" height="4" rx="1.5" stroke="#93C5FD" strokeWidth="1.8" />
        </svg>
      );

    case 'redis':
    case 'elasticache':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#EF4444" fillOpacity="0.15" />
          <path d="M12 3L4 7.5L12 12L20 7.5L12 3Z" fill="#EF4444" fillOpacity="0.4" stroke="#EF4444" strokeWidth="1.5" />
          <path d="M4 11.5L12 16L20 11.5" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 15.5L12 20L20 15.5" stroke="#FCA5A5" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'sqs':
    case 'sns':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#F97316" fillOpacity="0.15" />
          <rect x="4" y="6" width="6" height="12" rx="1" stroke="#F97316" strokeWidth="1.8" />
          <rect x="14" y="6" width="6" height="12" rx="1" stroke="#FB923C" strokeWidth="1.8" />
          <path d="M10 12H14" stroke="#FDBA74" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 's3':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#10B981" fillOpacity="0.15" />
          <path d="M4 7L12 3L20 7L12 11L4 7Z" stroke="#10B981" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M4 7V17L12 21V11" stroke="#34D399" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M20 7V17L12 21" stroke="#6EE7B7" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );

    case 'cloudfront':
    case 'route53':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#8B5CF6" fillOpacity="0.15" />
          <circle cx="12" cy="12" r="8" stroke="#8B5CF6" strokeWidth="1.8" />
          <ellipse cx="12" cy="12" rx="3.5" ry="8" stroke="#A78BFA" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="#A78BFA" strokeWidth="1.5" />
        </svg>
      );

    case 'cognito':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#EC4899" fillOpacity="0.15" />
          <circle cx="12" cy="8" r="4" stroke="#EC4899" strokeWidth="1.8" />
          <path d="M5 19C5 15.5 8.1 14 12 14C15.9 14 19 15.5 19 19" stroke="#F472B6" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'waf':
    case 'secrets-manager':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#EF4444" fillOpacity="0.15" />
          <path d="M12 3L4 6.5V11C4 16 7.4 20.3 12 21.5C16.6 20.3 20 16 20 11V6.5L12 3Z" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 12L11 14L15 10" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'eventbridge':
    case 'step-functions':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#F59E0B" fillOpacity="0.15" />
          <path d="M13 2L4 13H11L10 22L20 10H13L13 2Z" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'kinesis':
    case 'opensearch':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#06B6D4" fillOpacity="0.15" />
          <path d="M3 17L9 11L13 15L21 7" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 7H21V12" stroke="#22D3EE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'client':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#0EA5E9" fillOpacity="0.15" />
          <rect x="4" y="5" width="16" height="11" rx="2" stroke="#0EA5E9" strokeWidth="1.8" />
          <path d="M8 19H16M12 16V19" stroke="#38BDF8" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'generic':
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#64748B" fillOpacity="0.15" />
          <circle cx="12" cy="12" r="7" stroke="#94A3B8" strokeWidth="1.8" strokeDasharray="2 2" />
          <circle cx="12" cy="12" r="2" fill="#CBD5E1" />
        </svg>
      );
  }
};

function mapTypeToIcon(type?: SystemNodeType): AWSServiceIcon {
  switch (type) {
    case 'client':
      return 'client';
    case 'gateway':
      return 'api-gateway';
    case 'database':
      return 'rds';
    case 'cache':
      return 'redis';
    case 'queue':
      return 'sqs';
    case 'storage':
      return 's3';
    case 'service':
      return 'ec2';
    default:
      return 'generic';
  }
}
