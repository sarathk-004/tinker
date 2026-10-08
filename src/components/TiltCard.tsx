import React, { useRef } from 'react';

/**
 * Wraps a card so it leans toward the pointer, a few degrees at most, with a soft sheen where the pointer is, and settles back when the
 * pointer leaves. Only for mouse and pen, and not at all with reduced motion; touch screens get the plain card.
 */
export const TiltCard: React.FC<{ children: React.ReactNode; className?: string; max?: number }> = ({ children, className = '', max = 4 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const lean = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || reduced || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.transform = `perspective(900px) rotateX(${((0.5 - y) * max * 2).toFixed(2)}deg) rotateY(${((x - 0.5) * max * 2).toFixed(2)}deg)`;
    el.style.setProperty('--sheen-x', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--sheen-y', `${(y * 100).toFixed(1)}%`);
    el.dataset['lean'] = 'on';
  };
  const settle = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    delete el.dataset['lean'];
  };

  return (
    <div
      ref={ref}
      onPointerMove={lean}
      onPointerLeave={settle}
      onPointerCancel={settle}
      className={`relative will-change-transform motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out ${className}`}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-200 [[data-lean=on]>&]:opacity-100"
        style={{ background: 'radial-gradient(240px circle at var(--sheen-x, 50%) var(--sheen-y, 50%), rgb(255 255 255 / 0.10), transparent 60%)' }}
      />
    </div>
  );
};
