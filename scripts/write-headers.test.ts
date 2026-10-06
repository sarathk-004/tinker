import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module script without types
import { buildPolicy, withPolicy } from './write-headers.mjs';

describe('Content-Security-Policy for the built site', () => {
  it('lets the page connect only to itself, the API (and its WebSocket) and Supabase, and loads scripts only from itself', () => {
    const policy: string = buildPolicy({ VITE_API_URL: 'https://api.tinker.example/v1/ignored', VITE_SUPABASE_URL: 'https://abc.supabase.co/' });
    expect(policy).toContain("connect-src 'self' https://api.tinker.example wss://api.tinker.example https://abc.supabase.co");
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).not.toContain('blob:'.concat(' ')); // no blob: script permission (the audio worklet is a static file)
  });

  it('adds the bot-check origin only when a Turnstile site key is configured', () => {
    expect(buildPolicy({})).not.toContain('challenges.cloudflare.com');
    const on: string = buildPolicy({ VITE_TURNSTILE_SITE_KEY: '0x4AAAA' });
    expect(on).toContain('script-src \'self\' https://challenges.cloudflare.com');
    expect(on).toContain('frame-src https://challenges.cloudflare.com');
  });

  it('defaults to the local API when none is configured, and ignores an invalid address', () => {
    expect(buildPolicy({})).toContain('connect-src \'self\' http://localhost:8787 ws://localhost:8787');
    expect(buildPolicy({ VITE_API_URL: 'not a url', VITE_SUPABASE_URL: 'nope' })).toContain("connect-src 'self'");
  });

  it('inserts into the catch-all block, replaces nothing else, and creates the block when missing', () => {
    const file = '/*\n  X-Frame-Options: DENY\n\n/assets/*\n  Cache-Control: immutable\n';
    const out: string = withPolicy(file, 'default-src \'self\'');
    expect(out.startsWith("/*\n  Content-Security-Policy: default-src 'self'\n  X-Frame-Options: DENY")).toBe(true);
    expect(out).toContain('/assets/*\n  Cache-Control: immutable');
    expect(withPolicy('/assets/*\n  Cache-Control: x\n', 'p')).toBe('/*\n  Content-Security-Policy: p\n\n/assets/*\n  Cache-Control: x\n');
  });
});
