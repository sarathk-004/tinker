import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const originSchema = z.string().refine(
  (value) => {
    if (value === '*') return false;
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
    } catch {
      return false;
    }
  },
  { message: 'must be an exact http(s) origin without path or trailing slash; wildcards are not allowed' },
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65535).default(8787),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Comma-separated exact origins allowed by CORS. Required in production. */
    CORS_ORIGINS: z.string().optional(),
    /** Server-only database role connection string. The API will not start without it (tests inject a pool). */
    DATABASE_URL: z.url().optional(),
    /**
     * TLS to Postgres. `off` (local), `verify` (check the server certificate; give the CA via DATABASE_SSL_CA_FILE when it is not
     * publicly trusted, as with Supabase) or `no-verify` (encrypted but unauthenticated: development only).
     */
    DATABASE_SSL: z.enum(['off', 'verify', 'no-verify']).default('off'),
    DATABASE_SSL_CA_FILE: z.string().min(1).optional(),
    /** Supabase project URL; JWTs are verified against its JWKS (issuer = <url>/auth/v1). */
    SUPABASE_URL: z.url().optional(),
    JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    /** `dev` signs and verifies tokens with a throwaway local key through /dev/auth/login. Development only. */
    AUTH_MODE: z.enum(['supabase', 'dev']).optional(),
    /** Refuse tokens whose email address was never confirmed (defence in depth on top of Supabase's "Confirm email"). */
    REQUIRE_VERIFIED_EMAIL: z.enum(['true', 'false']).default('true'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100000).default(120),
    /** Server-side only. Without it AI commands answer 503 AI_UNAVAILABLE and manual editing is unaffected. */
    GEMINI_API_KEY: z.string().min(8).optional(),
    /** Default measured on 2026-10-06 with this app's real prompt: gemini-3.5-flash-lite answers in ~1.5-2 s; gemini-3.8-flash was overloaded and hung. */
    GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
    /** `off` omits the setting. `minimal` is rejected by some models (it was by gemini-3.8-flash). */
    GEMINI_THINKING_LEVEL: z.enum(['off', 'minimal', 'low', 'medium', 'high']).default('low'),
    /**
     * Whose model key the AI runs on: `server` (the operator's GEMINI_API_KEY serves everyone), `user` (every person brings their own
     * key; nothing runs on the operator's), or `user_or_server`. Default: `server` in development and tests, `user` in production, so a
     * deployed app never spends the operator's key unless the operator asks for it.
     */
    AI_KEY_MODE: z.enum(['server', 'user', 'user_or_server']).optional(),
    /** 32 random bytes, base64: seals people's own API keys at rest (required unless AI_KEY_MODE=server). Host secret store only. */
    KEY_ENCRYPTION_SECRET: z.string().optional(),
    /** Retired secrets, comma separated: stored keys sealed with them stay readable until `rotate-ai-keys` re-seals them. */
    KEY_ENCRYPTION_SECRET_PREVIOUS: z.string().optional(),
    /** Gemini Live model used for voice (verified against the real endpoint on 2026-10-06). */
    GEMINI_LIVE_MODEL: z.string().min(1).default('gemini-3.8-live'),
    /** Background worker (decision D12): how often to look for work, and how long a claim lasts without a heartbeat. */
    WORKER_POLL_MS: z.coerce.number().int().min(200).max(300_000).default(5_000),
    WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
    /** Spoken replies (text to speech). Verified against the real endpoint on 2026-10-06. */
    GEMINI_TTS_MODEL: z.string().min(1).default('gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts'),
    GEMINI_TTS_VOICE: z.string().min(1).default('Kore'),
    /** Voice sessions: server-wide cap, and the longest one session may last (the provider's own limit is about 10 minutes). */
    VOICE_MAX_SESSIONS: z.coerce.number().int().min(1).max(10_000).default(20),
    VOICE_MAX_SESSION_MS: z.coerce.number().int().min(10_000).max(900_000).default(600_000),
    /** Total wall-clock budget for interpreting one AI request, including every provider retry (decision D07). */
    AI_DEADLINE_MS: z.coerce.number().int().min(500).max(60_000).default(15_000),
    AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),
    AI_MAX_CONCURRENT: z.coerce.number().int().min(1).max(100).default(2),
    /** Daily allowance (security review H1). Strict on purpose; raise it deliberately, never by default. */
    AI_DAILY_LIMIT: z.coerce.number().int().min(0).max(1_000_000).default(20),
    VOICE_DAILY_LIMIT: z.coerce.number().int().min(0).max(1_000_000).default(10),
    /** The service-wide ceiling per day (budget breaker): when it is reached, model features pause for everyone until 00:00 UTC. */
    AI_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(0).max(100_000_000).default(1_000),
    VOICE_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(0).max(100_000_000).default(100),
  })
  .superRefine((env, ctx) => {
    const need = (key: string, message = 'is required in production') =>
      ctx.addIssue({ code: 'custom', path: [key], message });
    if (env.NODE_ENV === 'production') {
      if (!env.CORS_ORIGINS?.trim()) need('CORS_ORIGINS');
      if (!env.DATABASE_URL) need('DATABASE_URL');
      if (!env.SUPABASE_URL) need('SUPABASE_URL');
      if (env.DATABASE_SSL === 'no-verify') {
        need('DATABASE_SSL', 'no-verify is not allowed in production (use verify with DATABASE_SSL_CA_FILE)');
      }
    }
    const keyMode = env.AI_KEY_MODE ?? 'server';
    if (keyMode !== 'server') {
      if (!env.KEY_ENCRYPTION_SECRET) need('KEY_ENCRYPTION_SECRET', `is required when AI_KEY_MODE is ${keyMode} (people's API keys are stored encrypted)`);
      else if (!/^[A-Za-z0-9+/]{43}=$/.test(env.KEY_ENCRYPTION_SECRET.trim())) need('KEY_ENCRYPTION_SECRET', 'must be 32 random bytes encoded as base64 (44 characters)');
    }
    for (const previous of (env.KEY_ENCRYPTION_SECRET_PREVIOUS ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(previous)) need('KEY_ENCRYPTION_SECRET_PREVIOUS', 'every entry must be 32 random bytes encoded as base64 (44 characters)');
    }
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV !== 'development') {
      need('AUTH_MODE', 'dev auth is allowed only when NODE_ENV=development');
    }
    if (env.AUTH_MODE === 'supabase' && !env.SUPABASE_URL) need('SUPABASE_URL', 'is required when AUTH_MODE=supabase');
  });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  corsOrigins: string[];
  databaseUrl: string | undefined;
  databaseSsl: 'off' | 'verify' | 'no-verify';
  databaseSslCaFile: string | undefined;
  authMode: 'supabase' | 'dev';
  supabaseUrl: string | undefined;
  jwtAudience: string;
  requireVerifiedEmail: boolean;
  rateLimitPerMinute: number;
  ai: {
    /** Secret. Never log or return it. */
    apiKey: string | undefined;
    model: string;
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high';
    liveModel: string;
    /** Comma-separated, tried in order (the free tier of the older preview models allows only ~10 requests a day). */
    ttsModels: string[];
    ttsVoice: string;
    deadlineMs: number;
    ratePerMinute: number;
    maxConcurrent: number;
    /** Per-person and service-wide daily allowance (modules/usage). */
    dailyLimits: { ai: number; voice: number; globalAi: number; globalVoice: number };
  };
  voice: { maxSessions: number; maxSessionMs: number };
  worker: { pollMs: number; leaseSeconds: number };
  aiKeys: { mode: 'server' | 'user' | 'user_or_server'; secret: string | undefined; previousSecrets: string[] };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const DEV_DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** Validates the environment. Error messages name variables but never echo values (they may be secrets). */
export function loadConfig(input: Record<string, string | undefined> = process.env): Config {
  // One .env file serves both halves: the API accepts the browser's public project address when SUPABASE_URL is not set separately.
  const env = { ...input, ...(input['SUPABASE_URL'] || !input['VITE_SUPABASE_URL'] ? {} : { SUPABASE_URL: input['VITE_SUPABASE_URL'] }) };
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  }
  const e = parsed.data;

  const rawOrigins = e.CORS_ORIGINS?.trim()
    ? e.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : DEV_DEFAULT_ORIGINS;
  const problems: string[] = [];
  for (const origin of rawOrigins) {
    const result = originSchema.safeParse(origin);
    if (!result.success) problems.push(`CORS_ORIGINS: entry is not a valid origin (${result.error.issues[0]?.message})`);
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigins: rawOrigins,
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL,
    databaseSslCaFile: e.DATABASE_SSL_CA_FILE,
    // Dev auth (unauthenticated local login) is NEVER a default: NODE_ENV itself defaults to development.
    authMode: e.AUTH_MODE ?? 'supabase',
    supabaseUrl: e.SUPABASE_URL,
    jwtAudience: e.JWT_AUDIENCE,
    requireVerifiedEmail: e.REQUIRE_VERIFIED_EMAIL === 'true',
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    ai: {
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      thinkingLevel: e.GEMINI_THINKING_LEVEL,
      liveModel: e.GEMINI_LIVE_MODEL,
      ttsModels: e.GEMINI_TTS_MODEL.split(',').map((m) => m.trim()).filter(Boolean),
      ttsVoice: e.GEMINI_TTS_VOICE,
      deadlineMs: e.AI_DEADLINE_MS,
      ratePerMinute: e.AI_RATE_LIMIT_PER_MINUTE,
      maxConcurrent: e.AI_MAX_CONCURRENT,
      dailyLimits: { ai: e.AI_DAILY_LIMIT, voice: e.VOICE_DAILY_LIMIT, globalAi: e.AI_GLOBAL_DAILY_LIMIT, globalVoice: e.VOICE_GLOBAL_DAILY_LIMIT },
    },
    voice: { maxSessions: e.VOICE_MAX_SESSIONS, maxSessionMs: e.VOICE_MAX_SESSION_MS },
    worker: { pollMs: e.WORKER_POLL_MS, leaseSeconds: e.WORKER_LEASE_SECONDS },
    aiKeys: {
      mode: e.AI_KEY_MODE ?? 'server',
      secret: e.KEY_ENCRYPTION_SECRET?.trim(),
      previousSecrets: (e.KEY_ENCRYPTION_SECRET_PREVIOUS ?? '').split(',').map((v) => v.trim()).filter(Boolean),
    },
  };
}
