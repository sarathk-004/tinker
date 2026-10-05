/**
 * Browser configuration. Only PUBLIC values live here: the API address, the Supabase project URL and the Supabase publishable
 * key (public by design). Provider secrets (Gemini) never belong in the browser (see AGENTS.md).
 *
 * IMPORTANT: always reference each VITE_ variable by its full name (import.meta.env.VITE_NAME). Aliasing the whole environment
 * object makes Vite embed EVERY VITE_* variable from the developer's .env into the bundle, including stale secrets.
 */
export const config = {
  apiUrl: (import.meta.env.VITE_API_URL ?? `http://${typeof location === 'undefined' ? 'localhost' : location.hostname}:8787`).replace(/\/$/, ''),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  /** The local dev login (POST /dev/auth/login) is offered only by the Vite dev server, never in a production build. */
  devLoginAvailable: import.meta.env.DEV === true && import.meta.env.VITE_ENABLE_DEV_LOGIN !== 'false',
} as const;
