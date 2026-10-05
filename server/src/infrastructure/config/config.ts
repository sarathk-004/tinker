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
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100000).default(120),
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
  rateLimitPerMinute: number;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const DEV_DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** Validates the environment. Error messages name variables but never echo values (they may be secrets). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
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
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
  };
}
