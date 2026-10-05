import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TinkerLogo } from './TinkerLogo';
import { config } from '../config';
import { devLogin, saveSupabaseConnection, signInWithPassword, signUp, supabaseConnection, useAuthStore } from '../auth/auth';

const field =
  'w-full px-3 py-2 text-sm rounded-md bg-[#fafaf7] border border-[#e6e5e0] focus:border-[#26251e] focus:bg-white text-[#26251e] outline-none transition-all';

export const LoginScreen: React.FC = () => {
  const { busy, error, info } = useAuthStore();
  const connected = supabaseConnection() !== null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');

  const canSubmit = connected && email.trim() !== '' && password !== '' && !busy;

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#f7f7f4] px-4 font-sans text-[#26251e]">
      <div className="w-full max-w-sm rounded-lg bg-white border border-[#e6e5e0] shadow-xs p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <TinkerLogo size={30} />
          <span className="text-lg font-semibold tracking-tight">tinker</span>
        </div>
        <p className="text-sm text-[#5a5852] mb-5">Sign in to open your saved diagrams.</p>

        {connected ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) void signInWithPassword(email, password);
            }}
            className="space-y-3"
          >
            <input className={field} type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={field} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-[#f54e00] hover:bg-[#d04200] disabled:bg-[#e6e5e0] disabled:text-[#a09c92] text-white text-sm font-medium transition-all"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign in
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void signUp(email, password)}
              className="w-full px-3 py-2 rounded-md border border-[#e6e5e0] hover:border-[#cfcdc4] text-sm text-[#26251e] disabled:opacity-50 transition-all"
            >
              Create account
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (sbUrl.trim() && sbKey.trim()) saveSupabaseConnection({ url: sbUrl, key: sbKey });
            }}
            className="space-y-3"
          >
            <p className="text-xs text-[#5a5852]">
              Supabase is not configured for this app yet. Add <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</code> to the root <code className="font-mono">.env</code> and restart{' '}
              <code className="font-mono">npm run dev</code>, or enter them here once (the publishable key is public by design).
            </p>
            <input className={field} type="url" placeholder="https://<project>.supabase.co" value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} />
            <input className={field} type="text" placeholder="sb_publishable_…" value={sbKey} onChange={(e) => setSbKey(e.target.value)} />
            <button type="submit" disabled={!sbUrl.trim() || !sbKey.trim()} className="w-full px-3 py-2 rounded-md bg-[#26251e] text-white text-sm font-medium disabled:opacity-40">
              Save connection
            </button>
          </form>
        )}

        {error && <p role="alert" className="mt-3 text-xs text-[#cf2d56]">{error}</p>}
        {info && <p role="status" className="mt-3 text-xs text-[#1a7f37]">{info}</p>}

        {config.devLoginAvailable && (
          <div className="mt-5 pt-4 border-t border-[#e6e5e0]">
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#807d72] mb-2">Local development</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void devLogin(email.trim() || 'dev@example.com')}
              className="w-full px-3 py-2 rounded-md border border-dashed border-[#cfcdc4] hover:border-[#26251e] text-sm text-[#26251e] transition-all"
            >
              Developer login (no password)
            </button>
            <p className="mt-1.5 text-[11px] text-[#807d72]">Only works with the local API started with AUTH_MODE=dev. Never available in a production build.</p>
          </div>
        )}
      </div>
    </div>
  );
};
