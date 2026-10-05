/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_GEMINI_MODEL: string;
  readonly VITE_GEMINI_LIVE_WS_URL: string;
  readonly VITE_ENABLE_AUDIO_RESPONSE: string;
  /** Supabase project URL and publishable (browser-safe) key. The publishable key is public by design. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
