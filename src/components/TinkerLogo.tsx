import React from 'react';

interface TinkerLogoProps {
  size?: number;
  className?: string;
}

export const TinkerLogo: React.FC<TinkerLogoProps> = ({
  size = 28,
  className = '',
}) => {
  return (
    <img
      src="/logo.png"
      alt="Tinker Logo"
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
      className={`object-contain select-none flex-shrink-0 ${className}`}
    />
  );
};
