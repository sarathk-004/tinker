import { describe, expect, it } from 'vitest';
import { changeEmail, changePassword, cleanName, MAX_NAME_LENGTH, updateDisplayName } from './account';

describe('account changes', () => {
  it('tidies names: one space between words, trimmed, limited in length', () => {
    expect(cleanName('  Ada    Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('x'.repeat(200))).toHaveLength(MAX_NAME_LENGTH);
  });
  it('refuses an empty name before asking anyone', async () => {
    await expect(updateDisplayName('   ')).rejects.toThrow('Enter a name.');
  });
  it('refuses changes when nobody is signed in', async () => {
    await expect(changePassword('old', 'Str0ng!passw0rd')).rejects.toThrow('not signed in');
    await expect(changeEmail('old', 'a@b.co')).rejects.toThrow('not signed in');
  });
});
