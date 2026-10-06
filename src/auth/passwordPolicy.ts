/**
 * The password rules this app asks for. They MIRROR what is configured in Supabase (Authentication > Sign In / Providers > Email:
 * minimum length 10, digits, lowercase, uppercase and symbols required), so a person learns what is wrong before the request is sent.
 * Supabase remains the authority: it enforces its own rules whatever this file says. Passwords are never stored or logged here.
 */
export const MIN_PASSWORD_LENGTH = 10;

/** The symbols Supabase's "required characters" rule accepts. */
const SYMBOLS = '!@#$%^&*()_+-=[]{};\':"\\|<>?,./`~';

export interface PasswordRule {
  id: 'length' | 'lower' | 'upper' | 'digit' | 'symbol';
  label: string;
  ok: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, ok: password.length >= MIN_PASSWORD_LENGTH },
    { id: 'lower', label: 'A lowercase letter', ok: /[a-z]/.test(password) },
    { id: 'upper', label: 'An uppercase letter', ok: /[A-Z]/.test(password) },
    { id: 'digit', label: 'A digit', ok: /[0-9]/.test(password) },
    { id: 'symbol', label: 'A symbol such as ! @ # $ %', ok: [...password].some((c) => SYMBOLS.includes(c)) },
  ];
}

export const passwordIsAcceptable = (password: string): boolean => passwordRules(password).every((r) => r.ok);

/** One sentence naming what is still missing (for an error message). */
export function describeMissing(password: string): string {
  const missing = passwordRules(password).filter((r) => !r.ok).map((r) => r.label.charAt(0).toLowerCase() + r.label.slice(1));
  return missing.length === 0 ? '' : `Your password still needs: ${missing.join(', ')}.`;
}
