import React from 'react';

interface TinkerLogoProps {
  size?: number;
  className?: string;
  variant?: 'light' | 'muted';
}

export const TinkerLogo: React.FC<TinkerLogoProps> = ({
  size = 28,
  className = '',
  variant = 'light',
}) => {
  const src = variant === 'muted' ? '/logo-muted.png' : '/logo.png';

  return (
    <img
      src={src}
      alt="Tinker Logo"
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      className={`rounded-md object-contain select-none flex-shrink-0 ${className}`}
    />
  );
};
