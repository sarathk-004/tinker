import React from 'react';

interface TinkerLogoProps {
  /** Height in pixels; the width follows (the mark is 20 by 24). */
  size?: number;
  className?: string;
}

/** The Tinker mark: dark on the light theme, light on the dark theme (it follows the theme, not the device). */
export const TinkerLogo: React.FC<TinkerLogoProps> = ({ size = 28, className = '' }) => (
  <svg
    width={Math.round((size * 20) / 24)}
    height={size}
    viewBox="0 0 20 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Tinker"
    className={`flex-shrink-0 select-none fill-[#2B2B2B] dark:fill-[#F8F8F8] ${className}`}
  >
    <rect y="5.80048" width="6.55931" height="5.80049" />
    <rect x="13.1183" y="5.80048" width="6.55931" height="5.80049" />
    <rect x="6.5592" y="11.601" width="6.55931" height="5.80049" />
    <rect x="6.5592" width="6.55931" height="5.80049" />
    <rect x="13.1183" y="17.4015" width="6.55931" height="5.80049" />
  </svg>
);
