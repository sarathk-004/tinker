import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TinkerLogo } from './TinkerLogo';
import { config } from '../config';
import { devLogin, requestPasswordReset, saveSupabaseConnection, setNewPassword, signInWithGoogle, signInWithPassword, signUp, supabaseConnection, useAuthStore } from '../auth/auth';

const field =
  'w-full px-3 py-2 text-sm rounded-md bg-[#fafaf7] border border-[#e6e5e0] focus:border-[#26251e] focus:bg-white text-[#26251e] outline-none transition-all';

export const LoginScreen: React.FC = () => {
  const { busy, error, info, recovery } = useAuthStore();
  const [newPassword, setNewPasswordText] = useState('');
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

        {recovery ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newPassword && !busy) void setNewPassword(newPassword);
            }}
            className="space-y-3"
          >
            <p className="text-xs text-[#5a5852]">Choose a new password for your account.</p>
            <input className={field} type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={newPassword} onChange={(e) => setNewPasswordText(e.target.value)} />
            <button type="submit" disabled={newPassword.length < 8 || busy} className="w-full px-3 py-2 rounded-md bg-[#f54e00] hover:bg-[#d04200] disabled:bg-[#e6e5e0] disabled:text-[#a09c92] text-white text-sm font-medium">
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        ) : connected ? (
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
            <button type="button" disabled={busy || email.trim() === ''} onClick={() => void requestPasswordReset(email)} className="w-full text-xs text-[#5a5852] hover:text-[#26251e] underline-offset-2 hover:underline disabled:opacity-50">
              Forgot your password?
            </button>
            <div className="flex items-center gap-3 text-[11px] text-[#807d72]">
              <span className="flex-1 border-t border-[#e6e5e0]" />
              or
              <span className="flex-1 border-t border-[#e6e5e0]" />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void signInWithGoogle()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-[#e6e5e0] hover:border-[#26251e] bg-white text-sm font-medium text-[#26251e] disabled:opacity-50 transition-all"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z" />
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
                <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
                <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 7 8.9 4.8 12 4.8z" />
              </svg>
              Continue with Google
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
