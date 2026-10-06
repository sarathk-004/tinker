import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Circle, Loader2, MailCheck } from 'lucide-react';
import { TinkerLogo } from './TinkerLogo';
import { Turnstile, type TurnstileHandle } from './Turnstile';
import { config } from '../config';
import {
  devLogin,
  leavePendingConfirmation,
  requestPasswordReset,
  resendConfirmation,
  setNewPassword,
  signInWithPassword,
  signUp,
  supabaseConnection,
  useAuthStore,
} from '../auth/auth';
import { passwordRules } from '../auth/passwordPolicy';

const field =
  'w-full px-3 py-2 text-sm rounded-md bg-[#fafaf7] border border-[#e6e5e0] focus:border-[#26251e] focus:bg-white text-[#26251e] outline-none transition-all';
const primary =
  'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-[#f54e00] hover:bg-[#d04200] disabled:bg-[#e6e5e0] disabled:text-[#a09c92] text-white text-sm font-medium transition-all';

/** Live checklist of the password rules, so people know what is missing before they submit. */
const PasswordChecklist: React.FC<{ password: string }> = ({ password }) => (
  <ul className="space-y-0.5" aria-label="Password rules">
    {passwordRules(password).map((rule) => (
      <li key={rule.id} className={`flex items-center gap-1.5 text-[11px] ${rule.ok ? 'text-[#1a7f37]' : 'text-[#807d72]'}`}>
        {rule.ok ? <Check className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
        {rule.label}
      </li>
    ))}
  </ul>
);

export const LoginScreen: React.FC = () => {
  const { busy, error, info, recovery, pending, resendAvailableAt } = useAuthStore();
  const connected = supabaseConnection() !== null;
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPasswordText] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);
  const onToken = useCallback((token: string | null) => setCaptcha(token), []);
  const needsCaptcha = config.turnstileSiteKey !== '' && !captcha;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const waitSeconds = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  const afterAttempt = () => captchaRef.current?.reset(); // a bot-check token works only once
  const canSubmit = connected && email.trim() !== '' && password !== '' && !busy && !needsCaptcha;
  const signUpReady = canSubmit && passwordRules(password).every((r) => r.ok);

  let body: React.ReactNode;
  if (recovery) {
    const ok = passwordRules(newPassword).every((r) => r.ok);
    body = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && !busy) void setNewPassword(newPassword);
        }}
        className="space-y-3"
      >
        <p className="text-xs text-[#5a5852]">Choose a new password for your account.</p>
        <input className={field} type="password" autoComplete="new-password" placeholder="New password" value={newPassword} onChange={(e) => setNewPasswordText(e.target.value)} />
        <PasswordChecklist password={newPassword} />
        <button type="submit" disabled={!ok || busy} className={primary}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Save new password
        </button>
      </form>
    );
  } else if (pending) {
    body = (
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-sm text-[#26251e]">
          <MailCheck className="w-5 h-5 text-[#1a7f37] flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Check your email</p>
            <p className="text-xs text-[#5a5852] mt-0.5">
              Open the link we sent to <span className="font-mono">{pending.email}</span> to confirm your address. You can sign in once it is confirmed. The link works for a limited time and only once.
            </p>
          </div>
        </div>
        <Turnstile ref={captchaRef} onToken={onToken} />
        <button
          type="button"
          disabled={busy || waitSeconds > 0 || needsCaptcha}
          onClick={() => void resendConfirmation(pending.email, captcha ?? undefined).then(afterAttempt)}
          className="w-full px-3 py-2 rounded-md border border-[#e6e5e0] hover:border-[#cfcdc4] text-sm text-[#26251e] disabled:opacity-50 transition-all"
        >
          {waitSeconds > 0 ? `Send the link again in ${waitSeconds}s` : 'Send the link again'}
        </button>
        <button type="button" onClick={() => { leavePendingConfirmation(); setPassword(''); }} className="w-full text-xs text-[#5a5852] hover:text-[#26251e] hover:underline">
          Use a different email or sign in
        </button>
        <p className="text-[11px] text-[#807d72]">Not there? Check your spam folder. Messages can take a minute to arrive.</p>
      </div>
    );
  } else if (connected) {
    body = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'signin' ? canSubmit : signUpReady) {
            void (mode === 'signin' ? signInWithPassword(email, password, captcha ?? undefined) : signUp(email, password, captcha ?? undefined)).then(afterAttempt);
          }
        }}
        className="space-y-3"
      >
        <div className="flex rounded-md bg-[#fafaf7] border border-[#e6e5e0] p-0.5 text-xs font-medium" role="tablist">
          {(['signin', 'signup'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 py-1.5 rounded ${mode === m ? 'bg-white text-[#26251e] shadow-2xs border border-[#e6e5e0]' : 'text-[#5a5852]'}`}>
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
        <input className={field} type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={field} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'signup' && <PasswordChecklist password={password} />}
        <Turnstile ref={captchaRef} onToken={onToken} />
        <button type="submit" disabled={mode === 'signin' ? !canSubmit : !signUpReady} className={primary}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        {mode === 'signup' && <p className="text-[11px] text-[#807d72]">We will email you a link to confirm your address. You can sign in after you open it.</p>}
        {mode === 'signin' && (
          <button type="button" disabled={busy || email.trim() === '' || needsCaptcha} onClick={() => void requestPasswordReset(email, captcha ?? undefined).then(afterAttempt)} className="w-full text-xs text-[#5a5852] hover:text-[#26251e] underline-offset-2 hover:underline disabled:opacity-50">
            Forgot your password?
          </button>
        )}
      </form>
    );
  } else {
    // The build has no Supabase settings. People are never asked for them: a deployed build always has them, so this is a
    // setup problem for whoever runs the app, and only developers get the technical hint.
    body = import.meta.env.DEV ? (
      <p className="text-xs text-[#5a5852]" role="status">
        Sign-in is not configured in this build. Add <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
        <code className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</code> to the root <code className="font-mono">.env</code> and restart{' '}
        <code className="font-mono">npm run dev</code> (see docs/runbook.md).
      </p>
    ) : (
      <p className="text-xs text-[#5a5852]" role="status">
        Sign-in is not available right now. Please try again later or contact the person who runs this app.
      </p>
    );
  }

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#f7f7f4] px-4 font-sans text-[#26251e]">
      <div className="w-full max-w-sm rounded-lg bg-white border border-[#e6e5e0] shadow-xs p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <TinkerLogo size={30} />
          <span className="text-lg font-semibold tracking-tight">tinker</span>
        </div>
        <p className="text-sm text-[#5a5852] mb-5">{recovery ? 'Reset your password.' : pending ? 'One more step.' : 'Sign in to open your saved diagrams.'}</p>

        {body}

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
