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
  className = '',
  size = 24,
}) => {
  const resolvedName = name || mapTypeToIcon(type);

  // High-fidelity, self-contained SVG icons for 100% reliability (no external CDN network dropouts)
  switch (resolvedName) {
    case 'api-gateway':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#8C4FFF" fillOpacity="0.16" />
          <path d="M12 3.5L4.5 7.8V16.2L12 20.5L19.5 16.2V7.8L12 3.5Z" stroke="#8C4FFF" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 8.5L8 11V15L12 17.5L16 15V11L12 8.5Z" fill="#8C4FFF" fillOpacity="0.3" stroke="#8C4FFF" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="1.5" fill="#8C4FFF" />
        </svg>
      );

    case 'alb':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#8C4FFF" fillOpacity="0.16" />
          <circle cx="6" cy="12" r="2.5" fill="#8C4FFF" />
          <path d="M8.5 12H11M11 12L14 7M11 12L14 17" stroke="#8C4FFF" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="17.5" cy="7" r="2.5" stroke="#8C4FFF" strokeWidth="1.6" />
          <circle cx="17.5" cy="17" r="2.5" stroke="#8C4FFF" strokeWidth="1.6" />
        </svg>
      );

    case 'cloudfront':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#8C4FFF" fillOpacity="0.16" />
          <circle cx="12" cy="12" r="8" stroke="#8C4FFF" strokeWidth="1.8" />
          <ellipse cx="12" cy="12" rx="3.5" ry="8" stroke="#A78BFA" strokeWidth="1.4" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="#A78BFA" strokeWidth="1.4" />
          <circle cx="12" cy="4" r="1.2" fill="#8C4FFF" />
          <circle cx="12" cy="20" r="1.2" fill="#8C4FFF" />
        </svg>
      );

    case 'route53':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#8C4FFF" fillOpacity="0.16" />
          <circle cx="12" cy="12" r="8" stroke="#8C4FFF" strokeWidth="1.8" />
          <path d="M12 4L14 10L20 12L14 14L12 20L10 14L4 12L10 10L12 4Z" fill="#8C4FFF" fillOpacity="0.3" stroke="#8C4FFF" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );

    case 'waf':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#DD344C" fillOpacity="0.16" />
          <path d="M12 3.5L4.5 7V12C4.5 16.5 7.8 20.2 12 21.5C16.2 20.2 19.5 16.5 19.5 12V7L12 3.5Z" stroke="#DD344C" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8 12H16M12 8V16" stroke="#DD344C" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'ec2':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#EC7211" fillOpacity="0.16" />
          <rect x="5" y="5" width="14" height="14" rx="2" stroke="#EC7211" strokeWidth="1.8" />
          <path d="M9 12H15M12 9V15" stroke="#EC7211" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="3" cy="9" r="1" fill="#EC7211" />
          <circle cx="3" cy="15" r="1" fill="#EC7211" />
          <circle cx="21" cy="9" r="1" fill="#EC7211" />
          <circle cx="21" cy="15" r="1" fill="#EC7211" />
        </svg>
      );

    case 'lambda':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#EC7211" fillOpacity="0.16" />
          <path d="M7 19L11.5 6H13.5L18 19" stroke="#EC7211" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 15H16" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'ecs':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#EC7211" fillOpacity="0.16" />
          <path d="M12 3.5L4.5 7.8V16.2L12 20.5L19.5 16.2V7.8L12 3.5Z" stroke="#EC7211" strokeWidth="1.8" strokeLinejoin="round" />
          <rect x="8" y="8" width="8" height="8" rx="1.5" stroke="#EC7211" strokeWidth="1.5" />
        </svg>
      );

    case 'eks':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#EC7211" fillOpacity="0.16" />
          <circle cx="12" cy="12" r="7.5" stroke="#EC7211" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.5" fill="#EC7211" />
          <path d="M12 4.5V9.5M12 14.5V19.5M4.5 12H9.5M14.5 12H19.5" stroke="#EC7211" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'step-functions':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#CC2264" fillOpacity="0.16" />
          <rect x="4.5" y="4.5" width="5" height="5" rx="1" stroke="#CC2264" strokeWidth="1.6" />
          <rect x="14.5" y="4.5" width="5" height="5" rx="1" stroke="#CC2264" strokeWidth="1.6" />
          <rect x="9.5" y="14.5" width="5" height="5" rx="1" stroke="#CC2264" strokeWidth="1.6" />
          <path d="M7 9.5V12H12M17 9.5V12H12M12 12V14.5" stroke="#CC2264" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );

    case 'rds':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#3B82F6" fillOpacity="0.16" />
          <ellipse cx="12" cy="6" rx="7" ry="2.5" stroke="#3B82F6" strokeWidth="1.8" />
          <path d="M5 6v6c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6" stroke="#60A5FA" strokeWidth="1.8" />
          <path d="M5 12v6c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-6" stroke="#93C5FD" strokeWidth="1.8" />
        </svg>
      );

    case 'dynamodb':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#3B82F6" fillOpacity="0.16" />
          <rect x="5" y="4" width="14" height="4.5" rx="1.5" stroke="#3B82F6" strokeWidth="1.8" />
          <rect x="5" y="10" width="14" height="4.5" rx="1.5" stroke="#60A5FA" strokeWidth="1.8" />
          <rect x="5" y="16" width="14" height="4" rx="1.5" stroke="#93C5FD" strokeWidth="1.8" />
        </svg>
      );

    case 'opensearch':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#0052CC" fillOpacity="0.16" />
          <circle cx="10.5" cy="10.5" r="6" stroke="#0052CC" strokeWidth="1.8" />
          <path d="M15 15L20 20" stroke="#0052CC" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="10.5" cy="10.5" r="2.5" fill="#0052CC" fillOpacity="0.3" />
        </svg>
      );

    case 'redis':
    case 'elasticache':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#EF4444" fillOpacity="0.16" />
          <path d="M12 3.5L4 7.5L12 11.5L20 7.5L12 3.5Z" fill="#EF4444" fillOpacity="0.35" stroke="#EF4444" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M4 11.5L12 15.5L20 11.5" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15.5L12 19.5L20 15.5" stroke="#FCA5A5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'sqs':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#F97316" fillOpacity="0.16" />
          <rect x="4" y="6" width="6" height="12" rx="1.5" stroke="#F97316" strokeWidth="1.8" />
          <rect x="14" y="6" width="6" height="12" rx="1.5" stroke="#FB923C" strokeWidth="1.8" />
          <path d="M10 12H14M12.5 9.5L14.5 12L12.5 14.5" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'sns':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#F97316" fillOpacity="0.16" />
          <circle cx="6" cy="12" r="2.5" fill="#F97316" />
          <path d="M8.5 12C11 12 12 10 14.5 7M8.5 12C11 12 12 14 14.5 17" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="17.5" cy="7" r="2.5" stroke="#F97316" strokeWidth="1.6" />
          <circle cx="17.5" cy="17" r="2.5" stroke="#F97316" strokeWidth="1.6" />
        </svg>
      );

    case 'eventbridge':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#E05243" fillOpacity="0.16" />
          <circle cx="12" cy="12" r="3" fill="#E05243" />
          <circle cx="5" cy="6" r="2" stroke="#E05243" strokeWidth="1.5" />
          <circle cx="19" cy="6" r="2" stroke="#E05243" strokeWidth="1.5" />
          <circle cx="5" cy="18" r="2" stroke="#E05243" strokeWidth="1.5" />
          <circle cx="19" cy="18" r="2" stroke="#E05243" strokeWidth="1.5" />
          <path d="M6.5 7.5L10 10.5M17.5 7.5L14 10.5M6.5 16.5L10 13.5M17.5 16.5L14 13.5" stroke="#E05243" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'kinesis':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#EC7211" fillOpacity="0.16" />
          <path d="M4 12C6.5 8 9.5 8 12 12C14.5 16 17.5 16 20 12" stroke="#EC7211" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 7C6.5 3 9.5 3 12 7C14.5 11 17.5 11 20 7" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 17C6.5 13 9.5 13 12 17C14.5 21 17.5 21 20 17" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 's3':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#10B981" fillOpacity="0.16" />
          <path d="M4.5 7.5L12 3.5L19.5 7.5L12 11.5L4.5 7.5Z" stroke="#10B981" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M4.5 7.5V16.5L12 20.5V11.5" stroke="#34D399" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M19.5 7.5V16.5L12 20.5" stroke="#6EE7B7" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );

    case 'cognito':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#E7157B" fillOpacity="0.16" />
          <circle cx="12" cy="8" r="4" stroke="#E7157B" strokeWidth="1.8" />
          <path d="M5 19C5 15.5 8.1 14 12 14C15.9 14 19 15.5 19 19" stroke="#E7157B" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="17.5" cy="6.5" r="2" fill="#E7157B" />
        </svg>
      );

    case 'secrets-manager':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#DD344C" fillOpacity="0.16" />
          <rect x="6" y="11" width="12" height="9" rx="2" stroke="#DD344C" strokeWidth="1.8" />
          <path d="M9 11V7C9 5.34 10.34 4 12 4C13.66 4 15 5.34 15 7V11" stroke="#DD344C" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="15.5" r="1.5" fill="#DD344C" />
        </svg>
      );

    case 'client':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#0EA5E9" fillOpacity="0.16" />
          <rect x="4" y="5" width="16" height="11" rx="2" stroke="#0EA5E9" strokeWidth="1.8" />
          <path d="M8 19H16M12 16V19" stroke="#38BDF8" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'generic':
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect width="24" height="24" rx="5" fill="#64748B" fillOpacity="0.16" />
          <circle cx="12" cy="12" r="7" stroke="#64748B" strokeWidth="1.8" strokeDasharray="2.5 2.5" />
          <circle cx="12" cy="12" r="2.5" fill="#94A3B8" />
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
