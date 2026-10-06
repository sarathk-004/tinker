import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module script without types
import { scanDirectory, scanText } from './check-artifacts.mjs';

describe('release artifact scan (A30)', () => {
  it('passes clean browser code that uses only the public settings', () => {
    const bundle = 'const u = "https://abc.supabase.co"; const k = import.meta.env.VITE_SUPABASE_URL; fetch(`${import.meta.env.VITE_API_URL}/v1/me`);'.replace(/import\.meta\.env\./g, '');
    expect(scanText(bundle)).toEqual([]);
  });

  it('catches key shapes, server-only names, database URLs and unknown browser settings', () => {
    expect(scanText('x="AIzaSyA1234567890123456789012345678901"')).toContain('Google/Gemini API key (AIza...)');
    expect(scanText('k="AQ.Ab8RN6IxYzabcdefghijklmnop"')).toContain('Gemini key (AQ.Ab...)');
    expect(scanText('sb_secret_abcdefghijklmnop')).toContain('Supabase secret key (sb_secret_...)');
    expect(scanText('role:"service_role"')).toContain('Supabase service_role');
    expect(scanText('postgres://tinker:hunter2@db.example.com/tinker')).toContain('database URL with a password');
    expect(scanText('-----BEGIN PRIVATE KEY-----')).toContain('private key block');
    expect(scanText('process.GEMINI_API_KEY')).toContain('server-only setting name "GEMINI_API_KEY"');
    expect(scanText('const k = "VITE_GEMINI_API_KEY"')).toContain('unexpected browser setting name "VITE_GEMINI_API_KEY"');
  });

  it('catches the real value of a local secret without ever reporting it', () => {
    const findings = scanText('...abcSECRETVALUE12345...', [['GEMINI_API_KEY from server/.env', 'SECRETVALUE12345']]);
    expect(findings).toEqual(['the real value of GEMINI_API_KEY from server/.env']);
    expect(JSON.stringify(findings)).not.toContain('SECRETVALUE12345');
  });

  it('scans a directory tree and reports file names, not secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tinker-scan-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'const a="AQ.Ab8RN6IxYzabcdefghijklmnop";');
    const result = scanDirectory(dir, []);
    expect(result.scanned).toBe(2);
    expect(result.report).toEqual([{ file: 'assets/app.js', finding: 'Gemini key (AQ.Ab...)' }]);
  });
});
