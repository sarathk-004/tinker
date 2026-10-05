import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/infrastructure/config/config.ts';

const PROD_BASE = { DATABASE_URL: 'postgres://u:p@h/db', SUPABASE_URL: 'https://x.supabase.co' };

describe('loadConfig', () => {
  it('applies development defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ nodeEnv: 'development', host: '127.0.0.1', port: 8787, logLevel: 'info' });
    expect(config.corsOrigins).toContain('http://localhost:5173');
    expect(config.databaseUrl).toBeUndefined();
  });

  it('requires CORS_ORIGINS in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ...PROD_BASE })).toThrow(ConfigError);
    expect(loadConfig({ NODE_ENV: 'production', ...PROD_BASE, CORS_ORIGINS: 'https://app.example.com' }).corsOrigins).toEqual(['https://app.example.com']);
  });

  it('requires DATABASE_URL and SUPABASE_URL in production', () => {
    const base = { NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' };
    expect(() => loadConfig({ ...base, SUPABASE_URL: 'https://x.supabase.co' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgres://u:p@h/db' })).toThrow(/SUPABASE_URL/);
  });

  it('allows dev auth only when explicitly requested in development, never by default or in production', () => {
    expect(loadConfig({}).authMode).toBe('supabase'); // NODE_ENV defaults to development, so dev auth must not be implicit
    expect(loadConfig({ AUTH_MODE: 'dev' }).authMode).toBe('dev');
    expect(() => loadConfig({ NODE_ENV: 'production', ...PROD_BASE, CORS_ORIGINS: 'https://a.example.com', AUTH_MODE: 'dev' })).toThrow(/dev auth/);
    expect(() => loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'dev' })).toThrow(/dev auth/);
  });

  it('requires SUPABASE_URL when AUTH_MODE=supabase is explicit', () => {
    expect(() => loadConfig({ AUTH_MODE: 'supabase' })).toThrow(/SUPABASE_URL/);
  });

  it('database TLS: off by default, verify/no-verify selectable, no-verify forbidden in production', () => {
    expect(loadConfig({}).databaseSsl).toBe('off');
    expect(loadConfig({ DATABASE_SSL: 'verify', DATABASE_SSL_CA_FILE: '/tmp/ca.pem' })).toMatchObject({ databaseSsl: 'verify', databaseSslCaFile: '/tmp/ca.pem' });
    expect(() => loadConfig({ DATABASE_SSL: 'sometimes' })).toThrow(ConfigError);
    const prod = { NODE_ENV: 'production', ...PROD_BASE, CORS_ORIGINS: 'https://a.example.com' };
    expect(() => loadConfig({ ...prod, DATABASE_SSL: 'no-verify' })).toThrow(/no-verify/);
    expect(loadConfig({ ...prod, DATABASE_SSL: 'verify' }).databaseSsl).toBe('verify');
  });

  it('rejects wildcard, path-bearing and malformed origins', () => {
    for (const bad of ['*', 'https://app.example.com/', 'https://app.example.com/path', 'app.example.com', 'ftp://x.example.com']) {
      expect(() => loadConfig({ CORS_ORIGINS: bad }), bad).toThrow(ConfigError);
    }
  });

  it('rejects invalid ports and log levels', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(ConfigError);
  });

  it('never echoes values (which may be secrets) in error messages', () => {
    try {
      loadConfig({ DATABASE_URL: 'not-a-url-with-password-hunter2' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});
