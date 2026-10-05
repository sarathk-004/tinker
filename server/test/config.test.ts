import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/infrastructure/config/config.ts';

describe('loadConfig', () => {
  it('applies development defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ nodeEnv: 'development', host: '127.0.0.1', port: 8787, logLevel: 'info' });
    expect(config.corsOrigins).toContain('http://localhost:5173');
    expect(config.databaseUrl).toBeUndefined();
  });

  it('requires CORS_ORIGINS in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' }).corsOrigins).toEqual(['https://app.example.com']);
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
