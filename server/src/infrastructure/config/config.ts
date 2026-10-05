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
    /** Required from I3 onward; optional while the API has no persistence. */
    DATABASE_URL: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGINS?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'is required in production' });
    }
  });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  corsOrigins: string[];
  databaseUrl: string | undefined;
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
  };
}
