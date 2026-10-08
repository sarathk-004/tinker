import React, { useEffect, useState } from 'react';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A number that rolls like an odometer: each digit is a strip of 0 to 9 behind a window, and a change slides the strips to their new
 * digits, the ones first and each place to the left a little later. It starts at zero and rolls up when it appears. With reduced
 * motion it simply shows the number.
 */
export const RollingNumber: React.FC<{ value: number; className?: string }> = ({ value, className = '' }) => {
  const digits = String(Math.max(0, Math.round(value))).split('').map(Number);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const place = (i: number) => digits.length - 1 - i; // 0 for the ones column
  return (
    <span className={`tabular inline-flex leading-none ${className}`} role="img" aria-label={String(value)}>
      {digits.map((d, i) => (
        <span key={place(i)} aria-hidden className="relative inline-block h-[1em] overflow-hidden">
          <span
            className="block motion-safe:transition-transform motion-safe:duration-[900ms] motion-safe:ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: `translateY(${shown ? -d : 0}em)`, transitionDelay: `${place(i) * 70}ms` }}
          >
            {DIGITS.map((n) => (
              <span key={n} className="block h-[1em] leading-[1em]">
                {n}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
};
