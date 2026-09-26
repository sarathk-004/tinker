import React from 'react';
import { AWSServiceIcon, SystemNodeType } from '../../types/diagram';

interface AWSIconProps {
  name?: AWSServiceIcon;
  type?: SystemNodeType;
  className?: string;
  size?: number;
}

export const AWSIcon: React.FC<AWSIconProps> = ({
  name,
  type,
  className = "w-6 h-6",
  size = 24
}) => {
  // Determine icon to render based on name or fallback type
  const resolvedName = name || mapTypeToIcon(type);

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
          <path d="M5 8C5 6.34 8.13 5 12 5C15.87 5 19 6.34 19 8M5 8V16C5 17.66 8.13 19 12 19C15.87 19 19 17.66 19 16V8M5 8C5 9.66 8.13 11 12 11C15.87 11 19 9.66 19 8" stroke="#10B981" strokeWidth="1.8" />
          <path d="M12 11V19" stroke="#34D399" strokeWidth="1.5" />
        </svg>
      );

    case 'cloudfront':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#6366F1" fillOpacity="0.15" />
          <circle cx="12" cy="12" r="8" stroke="#6366F1" strokeWidth="1.8" />
          <ellipse cx="12" cy="12" rx="3.5" ry="8" stroke="#818CF8" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="#818CF8" strokeWidth="1.5" />
        </svg>
      );

    case 'client':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#64748B" fillOpacity="0.15" />
          <rect x="5" y="4" width="14" height="12" rx="2" stroke="#94A3B8" strokeWidth="1.8" />
          <path d="M10 20H14M12 16V20" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="10" r="1.5" fill="#38BDF8" />
        </svg>
      );

    case 'generic':
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="4" fill="#475569" fillOpacity="0.2" />
          <rect x="5" y="6" width="14" height="12" rx="2" stroke="#94A3B8" strokeWidth="1.8" />
          <line x1="8" y1="10" x2="16" y2="10" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="8" y1="14" x2="13" y2="14" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
};

function mapTypeToIcon(type?: SystemNodeType): AWSServiceIcon {
  switch (type) {
    case 'client': return 'client';
    case 'gateway': return 'api-gateway';
    case 'service': return 'ec2';
    case 'database': return 'rds';
    case 'cache': return 'elasticache';
    case 'queue': return 'sqs';
    case 'storage': return 's3';
    default: return 'generic';
  }
}
