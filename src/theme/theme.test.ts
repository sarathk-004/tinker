import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('theme choice', () => {
  it('light and dark are used as chosen, whatever the device prefers', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('system follows the device', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
