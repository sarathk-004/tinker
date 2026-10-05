/// <reference types="vite/client" />

/** Browser-visible configuration. Everything here is PUBLIC (it ships in the bundle): never put a secret in a VITE_* variable. */
interface ImportMetaEnv {
  /** Tinker API address. Defaults to http://<current host>:8787. */
  readonly VITE_API_URL?: string;
  /** Supabase project URL and publishable key (the publishable key is public by design). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Set to "false" to hide the local developer login in `npm run dev`. */
  readonly VITE_ENABLE_DEV_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
