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
  'lambda': 'logos:aws-lambda',
  'rds': 'logos:aws-rds',
  'dynamodb': 'logos:aws-dynamodb',
  'elasticache': 'logos:aws-elasticache',
  'redis': 'logos:redis',
  'sqs': 'logos:aws-sqs',
  'sns': 'logos:aws-sns',
  's3': 'logos:aws-s3',
  'cloudfront': 'logos:aws-cloudfront',
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

  // High-fidelity fallback SVG
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
          <path d="M5 6V12C5 13.38 8.13 14.5 12 14.5C15.87 14.5 19 13.38 19 12V6" stroke="#60A5FA" strokeWidth="1.8" />
          <path d="M5 12V18C5 19.38 8.13 20.5 12 20.5C15.87 20.5 19 19.38 19 18V12" stroke="#93C5FD" strokeWidth="1.8" />
        </svg>
      );

    case 'dynamodb':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#3B82F6" fillOpacity="0.15" />
          <ellipse cx="12" cy="7" rx="6" ry="2.5" stroke="#3B82F6" strokeWidth="1.8" />
          <path d="M6 7V17C6 18.38 8.69 19.5 12 19.5C15.31 19.5 18 18.38 18 17V7" stroke="#60A5FA" strokeWidth="1.8" />
          <path d="M12 7V19.5" stroke="#93C5FD" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
      );

    case 'elasticache':
    case 'redis':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#EF4444" fillOpacity="0.15" />
          <path d="M12 3L4 7.5L12 12L20 7.5L12 3Z" fill="#DC2626" fillOpacity="0.8" stroke="#EF4444" strokeWidth="1.5" />
          <path d="M4 11.5L12 16L20 11.5" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15.5L12 20L20 15.5" stroke="#FCA5A5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="7.5" r="1.5" fill="#FFFFFF" />
        </svg>
      );

    case 'sqs':
    case 'sns':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#EC4899" fillOpacity="0.15" />
          <rect x="4" y="6" width="16" height="12" rx="2" stroke="#EC4899" strokeWidth="1.8" />
          <path d="M8 10H16M8 14H13" stroke="#F472B6" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="16" cy="14" r="1" fill="#F472B6" />
        </svg>
      );

    case 's3':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#10B981" fillOpacity="0.15" />
          <path d="M4 7C4 5.9 7.58 5 12 5C16.42 5 20 5.9 20 7M4 7V17C4 18.1 7.58 19 12 19C16.42 19 20 18.1 20 17V7M4 7C4 8.1 7.58 9 12 9C16.42 9 20 8.1 20 7" stroke="#10B981" strokeWidth="1.8" />
          <path d="M4 12C4 13.1 7.58 14 12 14C16.42 14 20 13.1 20 12" stroke="#34D399" strokeWidth="1.8" />
        </svg>
      );

    case 'cloudfront':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#8B5CF6" fillOpacity="0.15" />
          <circle cx="12" cy="12" r="8" stroke="#8B5CF6" strokeWidth="1.8" />
          <ellipse cx="12" cy="12" rx="3.5" ry="8" stroke="#A78BFA" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="#A78BFA" strokeWidth="1.5" />
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
