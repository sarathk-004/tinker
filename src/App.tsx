import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { AppShell } from './shell/AppShell';
import { LoginScreen } from './components/LoginScreen';
import { initAuth, signOut, useAuthStore } from './auth/auth';
import { session } from './document/instance';
import { useWorkspaceStore } from './workspace/workspaceStore';
import { historyKeyHandler, watchHistory } from './history/history';

const Splash: React.FC<{ text: string }> = ({ text }) => (
  <div className="min-h-screen w-screen flex items-center justify-center bg-[#f7f7f4] text-[#5a5852] text-sm gap-2">
    <Loader2 className="w-4 h-4 animate-spin" />
    {text}
  </div>
);

export const App: React.FC = () => {
  const status = useAuthStore((s) => s.status);
  const recovery = useAuthStore((s) => s.recovery);
  const { phase, error } = useWorkspaceStore();

  useEffect(() => {
    void initAuth();
  }, []);

  // Sign-in / sign-out drives loading and discarding the workspace.
  useEffect(() => {
    const { bootstrap, reset } = useWorkspaceStore.getState();
    if (status === 'signedIn' && phase === 'idle') void bootstrap();
    if (status === 'signedOut' && phase !== 'idle') reset();
  }, [status, phase]);

  useEffect(() => {
    // Pick up edits made in another tab or device when we return to this one (only if we have nothing unsaved).
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      void session.refreshIfIdle().then(async (changed) => {
        if (changed) await useWorkspaceStore.getState().refreshList().catch(() => undefined);
      });
    };
    // Resume held saves as soon as the network is back (same idempotency keys: never applied twice).
    const onOnline = () => session.retry();
    // Never let the user close the tab while changes are unsaved.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', historyKeyHandler);
    const stopWatchingHistory = watchHistory();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', historyKeyHandler);
      stopWatchingHistory();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  if (status === 'loading') return <Splash text="Starting…" />;
  if (status === 'signedOut' || recovery) return <LoginScreen />;
  if (phase === 'idle' || phase === 'loading') return <Splash text="Loading your diagrams…" />;
  if (phase === 'error') {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-[#f7f7f4] px-4">
        <div className="max-w-sm rounded-lg bg-white border border-[#e6e5e0] p-6 text-sm text-[#26251e]">
          <p className="font-semibold mb-1">Could not load your diagrams</p>
          <p className="text-[#5a5852] mb-4">{error}</p>
          <div className="flex gap-2">
            <button onClick={() => useWorkspaceStore.setState({ phase: 'idle', error: null })} className="px-3 py-1.5 rounded-md bg-[#f54e00] text-white text-xs font-medium">
              Try again
            </button>
            <button onClick={() => void signOut()} className="px-3 py-1.5 rounded-md border border-[#e6e5e0] text-xs">
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <AppShell />;
};

export default App;
