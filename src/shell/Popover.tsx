import React, { useEffect, useRef } from 'react';

/** Closes on an outside click or Escape. The one place that behaviour lives, so every menu in the shell behaves the same. */
export function useDismiss(open: boolean, onClose: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open, onClose]);
  return ref;
}

export const MENU_PANEL = 'absolute z-50 rounded-xl border border-[#e6e5e0] bg-white shadow-[0_8px_30px_rgba(38,37,30,0.10)] p-1.5 animate-fade-in';
export const MENU_ITEM = 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-[#26251e] text-left hover:bg-[#f7f7f4] disabled:opacity-40 disabled:hover:bg-transparent';
export const MONO_LABEL = 'font-mono text-[10px] uppercase tracking-[0.08em] text-[#807d72]';
