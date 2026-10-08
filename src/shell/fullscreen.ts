import { useEffect, useState } from 'react';

/** Browser full screen for the whole app. Some browsers refuse it (or it is blocked inside a frame): then nothing happens, and we say so. */
export async function toggleFullscreen(): Promise<string | null> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return null;
  } catch {
    return 'This browser did not allow full screen.';
  }
}

export function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const change = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  return on;
}
