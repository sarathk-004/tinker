/**
 * Browser authentication. Supabase manages credentials, sessions and token refresh (supabase-js); Tinker's API verifies the
 * resulting access token on every request. In local development without Supabase, a dev login (POST /dev/auth/login) is offered.
 * Passwords are typed by the user and sent only to Supabase; nothing here stores them.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import type { AuthSource } from '../api/client';
import { config } from '../config';

const DEV_TOKEN_KEY = 'tinker_dev_token';
const SB_URL_KEY = 'tinker_supabase_url';
const SB_KEY_KEY = 'tinker_supabase_pk';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
  session: {
    get: (k: string) => {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k: string, v: string) => {
      try {
        sessionStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
    remove: (k: string) => {
      try {
        sessionStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  },
};

export interface SupabaseConnection {
  url: string;
  key: string;
}

/** Env first (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY); otherwise what the user entered on the sign-in screen. */
export function supabaseConnection(): SupabaseConnection | null {
  const url = config.supabaseUrl || store.get(SB_URL_KEY) || '';
  const key = config.supabasePublishableKey || store.get(SB_KEY_KEY) || '';
  return url && key ? { url, key } : null;
}

let client: SupabaseClient | null = null;
let clientFor = '';
function supabase(): SupabaseClient | null {
  const conn = supabaseConnection();
  if (!conn) return null;
  const id = `${conn.url}|${conn.key}`;
  if (!client || clientFor !== id) {
    // PKCE keeps tokens out of the address bar; detectSessionInUrl picks the session up when Google or an email link returns here.
    client = createClient(conn.url, conn.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
    clientFor = id;
  }
  return client;
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  email: string | null;
  mode: 'supabase' | 'dev' | null;
  busy: boolean;
  error: string | null;
  info: string | null;
  /** The user arrived from a password-reset email: they must choose a new password before anything else. */
  recovery: boolean;
}

export const useAuthStore = create<AuthState>(() => ({ status: 'loading', email: null, mode: null, busy: false, error: null, info: null, recovery: false }));
const set = useAuthStore.setState;

/** Display only (not verified): the email claim of a dev token, for the header. */
function emailFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

function devTokenValid(token: string | null): token is string {
  if (!token) return false;
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof exp === 'number' && exp * 1000 > Date.now() + 5_000;
  } catch {
    return false;
  }
}

let started = false;
export async function initAuth(): Promise<void> {
  if (started) return;
  started = true;
  const sb = supabase();
  if (sb) {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') set({ recovery: true });
      if (session) set({ status: 'signedIn', email: session.user.email ?? null, mode: 'supabase', error: null });
      else if (!devTokenValid(store.session.get(DEV_TOKEN_KEY))) set({ status: 'signedOut', email: null, mode: null, recovery: false });
    });
    const returned = oauthErrorFromUrl();
    if (returned) set({ error: returned });
    cleanAuthParamsFromUrl();
    const { data } = await sb.auth.getSession();
    if (data.session) return void set({ status: 'signedIn', email: data.session.user.email ?? null, mode: 'supabase' });
  }
  const dev = store.session.get(DEV_TOKEN_KEY);
  if (devTokenValid(dev)) return void set({ status: 'signedIn', email: emailFromToken(dev), mode: 'dev' });
  store.session.remove(DEV_TOKEN_KEY);
  set({ status: 'signedOut' });
}

export function saveSupabaseConnection(conn: SupabaseConnection): void {
  store.set(SB_URL_KEY, conn.url.trim().replace(/\/$/, ''));
  store.set(SB_KEY_KEY, conn.key.trim());
  client = null;
  started = false;
  void initAuth();
}

async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  set({ busy: true, error: null, info: null });
  try {
    return await fn();
  } catch (e) {
    set({ error: e instanceof Error ? e.message : 'Something went wrong.' });
    return undefined;
  } finally {
    set({ busy: false });
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await guard(async () => {
    const sb = supabase();
    if (!sb) throw new Error('Supabase is not configured yet.');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  });
}

export async function signUp(email: string, password: string): Promise<void> {
  await guard(async () => {
    const sb = supabase();
    if (!sb) throw new Error('Supabase is not configured yet.');
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: appOrigin() } });
    if (error) throw new Error(error.message);
    if (!data.session) set({ info: 'Account created. Check your email to confirm it, then sign in.' });
  });
}

/** The page address people return to after Google or an email link. Must be allowed in Supabase (Authentication > URL configuration). */
export const appOrigin = (): string => (typeof window === 'undefined' ? '' : window.location.origin);

/** Continue with Google: leaves for Google, then returns here already signed in (PKCE). Needs the Google provider enabled in Supabase. */
export async function signInWithGoogle(): Promise<void> {
  await guard(async () => {
    const sb = supabase();
    if (!sb) throw new Error('Supabase is not configured yet.');
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appOrigin() } });
    if (error) throw new Error(error.message);
  });
}

/** Email a password-reset link. The answer never says whether the address has an account (no account probing). */
export async function requestPasswordReset(email: string): Promise<void> {
  await guard(async () => {
    const sb = supabase();
    if (!sb) throw new Error('Supabase is not configured yet.');
    if (!email.trim()) throw new Error('Enter your email address first.');
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appOrigin() });
    if (error && !/not found|no user/i.test(error.message)) throw new Error(error.message);
    set({ info: 'If that address has an account, a reset link is on its way. Check your email.' });
  });
}

/** After following the reset link: choose the new password, then continue into the app. */
export async function setNewPassword(password: string): Promise<void> {
  await guard(async () => {
    const sb = supabase();
    if (!sb) throw new Error('Supabase is not configured yet.');
    if (password.length < 8) throw new Error('Use at least 8 characters.');
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    set({ recovery: false, info: 'Password updated.' });
  });
}

/** Google or Supabase can send the user back with an error in the address (denied consent, provider not enabled...). */
export function oauthErrorFromUrl(href: string = typeof window === 'undefined' ? '' : window.location.href): string | null {
  try {
    const url = new URL(href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const description = url.searchParams.get('error_description') ?? hash.get('error_description');
    const code = url.searchParams.get('error') ?? hash.get('error');
    if (!description && !code) return null;
    if (code === 'access_denied') return 'Google sign-in was cancelled.';
    return `Sign-in did not complete: ${(description ?? code ?? '').replace(/\+/g, ' ').slice(0, 160)}`;
  } catch {
    return null;
  }
}

/** Remove one-time sign-in parameters (code, errors, tokens) from the visible address once they have been used. */
export function cleanAuthParamsFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const had = ['code', 'error', 'error_code', 'error_description'].some((k) => url.searchParams.has(k)) || /access_token|error=/.test(url.hash);
  if (!had) return;
  ['code', 'error', 'error_code', 'error_description'].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

export async function devLogin(email: string): Promise<void> {
  await guard(async () => {
    const res = await fetch(`${config.apiUrl}/dev/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {
      throw new Error(`Cannot reach the API at ${config.apiUrl}. Start it with npm run dev:api.`);
    });
    const json = (await res.json().catch(() => ({}))) as { token?: string; error?: { message?: string } };
    if (!res.ok || !json.token) throw new Error(json.error?.message ?? 'Dev login is not available (start the API with AUTH_MODE=dev).');
    store.session.set(DEV_TOKEN_KEY, json.token);
    set({ status: 'signedIn', email: email.trim(), mode: 'dev' });
  });
}

export async function signOut(options: { expired?: boolean } = {}): Promise<void> {
  store.session.remove(DEV_TOKEN_KEY);
  const sb = supabase();
  if (sb) await sb.auth.signOut().catch(() => undefined);
  set({ status: 'signedOut', email: null, mode: null, error: null, recovery: false, info: options.expired ? 'Your session expired. Please sign in again; your saved diagrams are safe.' : null });
}

/** What the API client uses: the current Supabase access token (auto-refreshed by supabase-js) or the dev token. */
export const authSource: AuthSource = {
  async getAccessToken() {
    const sb = supabase();
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data.session) return data.session.access_token;
    }
    const dev = store.session.get(DEV_TOKEN_KEY);
    return devTokenValid(dev) ? dev : null;
  },
  async refresh() {
    const sb = supabase();
    if (!sb) return null;
    const { data, error } = await sb.auth.refreshSession();
    return error ? null : (data.session?.access_token ?? null);
  },
  onUnauthorized() {
    void signOut({ expired: true });
  },
};
