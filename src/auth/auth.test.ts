import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A pretend Supabase client that records what the app asks of it. */
const fake = vi.hoisted(() => {
  const f = {
    calls: [] as Array<[string, unknown]>,
    authListener: undefined as undefined | ((event: string, session: unknown) => void),
    session: null as null | { access_token: string; user: { email: string } },
    nextError: null as null | { message: string },
    created: [] as unknown[],
  };
  const record = (name: string, arg: unknown) => {
    f.calls.push([name, arg]);
    const error = f.nextError;
    f.nextError = null;
    return error;
  };
  const client = {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        f.authListener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session: f.session } }),
      signInWithOAuth: async (arg: unknown) => ({ error: record('signInWithOAuth', arg) }),
      resetPasswordForEmail: async (email: string, opts: unknown) => ({ error: record('resetPasswordForEmail', { email, opts }) }),
      updateUser: async (arg: unknown) => ({ error: record('updateUser', arg) }),
      signUp: async (arg: unknown) => ({ data: { session: null }, error: record('signUp', arg) }),
      signInWithPassword: async (arg: unknown) => ({ error: record('signInWithPassword', arg) }),
      signOut: async () => ({ error: record('signOut', null) }),
      refreshSession: async () => ({ data: { session: f.session }, error: null }),
    },
  };
  return { f, client };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    fake.f.created.push(args);
    return fake.client;
  },
}));

const ORIGIN = 'https://tinker.example.app';
const memory = () => {
  const data = new Map<string, string>([
    ['tinker_supabase_url', 'https://abc.supabase.co'],
    ['tinker_supabase_pk', 'sb_publishable_test'],
  ]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

let auth: typeof import('./auth');
const replaceState = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  fake.f.calls.length = 0;
  fake.f.created.length = 0;
  fake.f.authListener = undefined;
  fake.f.session = null;
  fake.f.nextError = null;
  replaceState.mockReset();
  vi.stubGlobal('localStorage', memory());
  vi.stubGlobal('sessionStorage', memory());
  vi.stubGlobal('window', { location: { origin: ORIGIN, href: `${ORIGIN}/`, pathname: '/', search: '' }, history: { replaceState } });
  auth = await import('./auth');
});

describe('Continue with Google', () => {
  it('asks Supabase for the Google provider and returns to this app (PKCE, session picked up from the address)', async () => {
    await auth.initAuth();
    await auth.signInWithGoogle();
    expect(fake.f.calls.find(([n]) => n === 'signInWithOAuth')![1]).toEqual({ provider: 'google', options: { redirectTo: ORIGIN } });
    const options = (fake.f.created[0] as [string, string, { auth: Record<string, unknown> }])[2].auth;
    expect(options).toMatchObject({ flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true });
    expect(auth.useAuthStore.getState().error).toBeNull();
  });

  it('shows the provider\'s message when Google is not enabled in Supabase, and stays signed out', async () => {
    await auth.initAuth();
    fake.f.nextError = { message: 'Unsupported provider: provider is not enabled' };
    await auth.signInWithGoogle();
    expect(auth.useAuthStore.getState()).toMatchObject({ status: 'signedOut', error: 'Unsupported provider: provider is not enabled', busy: false });
  });

  it('becomes signed in when Supabase reports the returned session', async () => {
    await auth.initAuth();
    fake.f.authListener?.('SIGNED_IN', { access_token: 't', user: { email: 'g@example.com' } });
    expect(auth.useAuthStore.getState()).toMatchObject({ status: 'signedIn', email: 'g@example.com', mode: 'supabase' });
  });
});

describe('password reset and email confirmation landing', () => {
  it('sends the reset link back to this app, and gives the same answer whether or not the address has an account', async () => {
    await auth.initAuth();
    await auth.requestPasswordReset(' me@example.com ');
    expect(fake.f.calls.find(([n]) => n === 'resetPasswordForEmail')![1]).toEqual({ email: 'me@example.com', opts: { redirectTo: ORIGIN } });
    const known = auth.useAuthStore.getState().info;
    fake.f.nextError = { message: 'User not found' };
    await auth.requestPasswordReset('nobody@example.com');
    expect(auth.useAuthStore.getState().info).toBe(known); // no account probing
    expect(auth.useAuthStore.getState().error).toBeNull();
  });

  it('asks for an address first, and reports real failures (for example rate limits)', async () => {
    await auth.initAuth();
    await auth.requestPasswordReset('   ');
    expect(auth.useAuthStore.getState().error).toMatch(/enter your email/i);
    expect(fake.f.calls.some(([n]) => n === 'resetPasswordForEmail')).toBe(false);
    fake.f.nextError = { message: 'Email rate limit exceeded' };
    await auth.requestPasswordReset('me@example.com');
    expect(auth.useAuthStore.getState().error).toBe('Email rate limit exceeded');
  });

  it('arriving from the reset email forces choosing a new password before the app opens', async () => {
    await auth.initAuth();
    fake.f.authListener?.('PASSWORD_RECOVERY', { access_token: 't', user: { email: 'me@example.com' } });
    expect(auth.useAuthStore.getState()).toMatchObject({ recovery: true, status: 'signedIn' });
    await auth.setNewPassword('short');
    expect(auth.useAuthStore.getState().error).toMatch(/at least 8/);
    expect(fake.f.calls.some(([n]) => n === 'updateUser')).toBe(false);
    await auth.setNewPassword('a-long-enough-password');
    expect(fake.f.calls.find(([n]) => n === 'updateUser')![1]).toEqual({ password: 'a-long-enough-password' });
    expect(auth.useAuthStore.getState()).toMatchObject({ recovery: false, info: 'Password updated.' });
  });

  it('sign-up asks for the confirmation email to land back in this app', async () => {
    await auth.initAuth();
    await auth.signUp('new@example.com', 'a-long-enough-password');
    expect(fake.f.calls.find(([n]) => n === 'signUp')![1]).toEqual({ email: 'new@example.com', password: 'a-long-enough-password', options: { emailRedirectTo: ORIGIN } });
    expect(auth.useAuthStore.getState().info).toMatch(/check your email/i);
  });
});

describe('returning from Google or an email link', () => {
  it('turns an error in the address into a plain message', () => {
    expect(auth.oauthErrorFromUrl(`${ORIGIN}/?error=access_denied&error_description=User+denied`)).toBe('Google sign-in was cancelled.');
    expect(auth.oauthErrorFromUrl(`${ORIGIN}/#error=server_error&error_description=Unable+to+exchange+external+code`)).toBe('Sign-in did not complete: Unable to exchange external code');
    expect(auth.oauthErrorFromUrl(`${ORIGIN}/`)).toBeNull();
    expect(auth.oauthErrorFromUrl('not a url')).toBeNull();
  });

  it('removes one-time parameters from the visible address and leaves everything else alone', () => {
    vi.stubGlobal('window', { location: { href: `${ORIGIN}/diagrams?tab=1&code=abc123&error=x`, pathname: '/diagrams', search: '?tab=1&code=abc123&error=x' }, history: { replaceState } });
    auth.cleanAuthParamsFromUrl();
    expect(replaceState).toHaveBeenCalledWith({}, '', '/diagrams?tab=1');
    replaceState.mockReset();
    vi.stubGlobal('window', { location: { href: `${ORIGIN}/diagrams?tab=1`, pathname: '/diagrams', search: '?tab=1' }, history: { replaceState } });
    auth.cleanAuthParamsFromUrl();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('an expired session returns to sign-in with a kind explanation, not a silent logout', async () => {
    await auth.initAuth();
    fake.f.authListener?.('SIGNED_IN', { access_token: 't', user: { email: 'me@example.com' } });
    auth.authSource.onUnauthorized();
    await vi.waitFor(() => expect(auth.useAuthStore.getState().status).toBe('signedOut'));
    expect(auth.useAuthStore.getState().info).toMatch(/session expired.*saved diagrams are safe/i);
  });

  it('a normal sign-out carries no such message', async () => {
    await auth.initAuth();
    await auth.signOut();
    expect(auth.useAuthStore.getState()).toMatchObject({ status: 'signedOut', info: null });
  });
});
