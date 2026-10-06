import { describe, expect, it } from 'vitest';
import { describeMissing, passwordIsAcceptable, passwordRules } from './passwordPolicy';

describe('password rules (mirror of the Supabase settings)', () => {
  it('accepts a password with 10+ characters, lower, upper, digit and symbol', () => {
    expect(passwordIsAcceptable('Str0ng!Passw0rd')).toBe(true);
    expect(passwordIsAcceptable('aB3$aB3$aB')).toBe(true); // exactly 10
  });

  it('rejects each missing piece and says which', () => {
    expect(passwordIsAcceptable('Short1!a')).toBe(false); // 8
    expect(passwordIsAcceptable('alllowercase1!')).toBe(false);
    expect(passwordIsAcceptable('ALLUPPERCASE1!')).toBe(false);
    expect(passwordIsAcceptable('NoDigitsHere!!')).toBe(false);
    expect(passwordIsAcceptable('NoSymbols12345')).toBe(false);
    expect(describeMissing('abc')).toBe('Your password still needs: at least 10 characters, an uppercase letter, a digit, a symbol such as ! @ # $ %.');
    expect(describeMissing('Str0ng!Passw0rd')).toBe('');
  });

  it('every symbol Supabase accepts counts', () => {
    const symbols = '!@#$%^&*()_+-=[]{};' + "'" + ':"' + '\\' + '|<>?,./`~';
    for (const c of symbols) expect(passwordRules(`Abcdefgh1${c}`).find((r) => r.id === 'symbol')!.ok).toBe(true);
    expect(passwordRules('Abcdefgh12').find((r) => r.id === 'symbol')!.ok).toBe(false);
    expect(passwordRules('Abcdefgh1 ').find((r) => r.id === 'symbol')!.ok).toBe(false); // a space is not a symbol
  });
});
