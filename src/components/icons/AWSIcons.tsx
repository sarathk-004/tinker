import React from 'react';
import { AWSServiceIcon, SystemNodeType } from '../../types/diagram';
import { AWS_OFFICIAL_ICONS } from './awsIconDefinitions';
import { AWS_MORE_ICONS } from './awsMoreIcons';
import { CATEGORY_COLOR, catalogEntry } from '../../catalog/services';

const ICONS = { ...AWS_MORE_ICONS, ...AWS_OFFICIAL_ICONS };

/** Letters for a service with no official icon: "GuardDuty" -> "GD", "Rekognition" -> "RE". */
export const badgeLetters = (label: string): string => {
  const words = label.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const camel = (words[0] ?? '').match(/[A-Z][a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? [];
  const parts = words.length > 1 ? words : camel;
  return (parts.length > 1 ? (parts[0]![0]! + parts[1]![0]!) : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
};

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

  // If official AWS service icon exists in bundle, render the authentic AWS architecture vector graphic
  const officialIcon = ICONS[resolvedName];
  if (officialIcon) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${officialIcon.width} ${officialIcon.height}`}
        className={`flex-shrink-0 ${className}`}
        dangerouslySetInnerHTML={{ __html: officialIcon.body }}
      />
    );
  }

  // Client / End-user interface icon
  if (resolvedName === 'client') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`text-[#0EA5E9] flex-shrink-0 ${className}`}
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <line x1="8" y1="20" x2="16" y2="20" />
        <line x1="12" y1="16" x2="12" y2="20" />
      </svg>
    );
  }

  // A catalog service without an official icon: a coloured badge with its letters.
  const entry = catalogEntry(resolvedName);
  if (entry && resolvedName !== 'generic') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={`flex-shrink-0 ${className}`} role="img" aria-label={entry.label}>
        <rect width="24" height="24" rx="4" fill={CATEGORY_COLOR[entry.category]} />
        <text x="12" y="16" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff" fontFamily="Inter, system-ui, sans-serif">{badgeLetters(entry.label)}</text>
      </svg>
    );
  }

  // Generic cloud service fallback
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-neutral-400 flex-shrink-0 ${className}`}
    >
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
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
