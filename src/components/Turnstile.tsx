import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { config } from '../config';

interface TurnstileApi {
  render(element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void; theme: 'light' }): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;
const loadScript = (): Promise<void> => {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('The security check could not be loaded.'));
    document.head.appendChild(el);
  });
  return scriptPromise;
};

export interface TurnstileHandle {
  /** Ask for a fresh check (a token works once). */
  reset(): void;
}

/**
 * Cloudflare Turnstile bot check for the sign-in forms. Renders nothing when no site key is configured (the check is optional and is
 * switched on in the Supabase dashboard together with the matching SECRET key, which never reaches the browser).
 */
export const Turnstile = React.forwardRef<TurnstileHandle, { onToken: (token: string | null) => void }>(({ onToken }, ref) => {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const siteKey = config.turnstileSiteKey;

  useImperativeHandle(ref, () => ({
    reset() {
      onToken(null);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
  }));

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !box.current || !window.turnstile) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    }, () => onToken(null));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, onToken]);

  return siteKey ? <div ref={box} className="flex justify-center" /> : null;
});
Turnstile.displayName = 'Turnstile';
