import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for secrets we must be able to read back (a user's own model API key).
 *
 *  - AES-256-GCM: confidential AND tamper-evident (a changed byte fails to decrypt, it never decrypts to something else).
 *  - A fresh random 96-bit nonce per secret.
 *  - `aad` (additional authenticated data) binds the ciphertext to where it belongs (`<userId>:<provider>`): a stolen row copied onto
 *    another user's record does not decrypt.
 *  - The master key lives only in the server's environment / the host's secret store, never in the database. A database leak alone
 *    yields ciphertext. Keys are identified by a short non-reversible fingerprint so they can be rotated: new secrets are sealed with
 *    the current key, old ones stay readable while their key is listed as previous, and `rotate-ai-keys` re-seals them.
 */
export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: string;
}

export class SecretBoxError extends Error {
  constructor(
    public readonly reason: 'UNKNOWN_KEY_VERSION' | 'TAMPERED' | 'BAD_KEY',
    message: string,
  ) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export interface SecretBox {
  /** Fingerprint of the key new secrets are sealed with. */
  readonly keyVersion: string;
  seal(plaintext: string, aad: string): Sealed;
  open(sealed: Sealed, aad: string): string;
  /** Can secrets sealed under this key version still be opened? */
  canOpen(keyVersion: string): boolean;
}

const fingerprint = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);

/** `KEY_ENCRYPTION_SECRET` is 32 random bytes, base64 encoded: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. */
export function decodeSecret(base64: string): Buffer {
  const text = base64.trim();
  // 32 bytes is exactly 43 base64 characters plus one '=' of padding. Anything else is a typo, not a key.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) throw new SecretBoxError('BAD_KEY', 'The encryption secret must be 32 random bytes encoded as base64 (44 characters).');
  return Buffer.from(text, 'base64');
}

export function createSecretBox(options: { current: string; previous?: readonly string[] }): SecretBox {
  const current = decodeSecret(options.current);
  const keys = new Map<string, Buffer>([[fingerprint(current), current]]);
  for (const old of options.previous ?? []) {
    const key = decodeSecret(old);
    keys.set(fingerprint(key), key);
  }
  const keyVersion = fingerprint(current);
  return {
    keyVersion,
    canOpen: (version) => keys.has(version),
    seal(plaintext, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion };
    },
    open(sealed, aad) {
      const key = keys.get(sealed.keyVersion);
      if (!key) throw new SecretBoxError('UNKNOWN_KEY_VERSION', 'This secret was sealed with a key that is no longer configured.');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(sealed.tag);
        return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw new SecretBoxError('TAMPERED', 'The stored secret failed its integrity check.');
      }
    },
  };
}
