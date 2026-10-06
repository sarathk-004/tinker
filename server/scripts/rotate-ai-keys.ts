/**
 * Re-seal people's stored API keys with the current master key (decision I9-BYOK).
 *   1. Generate a new secret:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. Set KEY_ENCRYPTION_SECRET=<new> and KEY_ENCRYPTION_SECRET_PREVIOUS=<old> on the API (stored keys stay readable).
 *   3. npm run rotate:ai-keys -w @tinker/server        (this script; reads the same two variables and DATABASE_URL)
 *   4. When it reports 0 unreadable, remove the old secret from KEY_ENCRYPTION_SECRET_PREVIOUS.
 * Prints counts only; no key, ciphertext or secret is ever printed.
 */
import { loadConfig } from '../src/infrastructure/config/config.ts';
import { createSecretBox } from '../src/infrastructure/crypto/secret-box.ts';
import { createPool } from '../src/infrastructure/database/pool.ts';
import { rotateAiKeys } from '../src/modules/ai-keys/rotate.ts';

const config = loadConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development', AI_KEY_MODE: process.env.AI_KEY_MODE ?? 'user' });
if (!config.databaseUrl || !config.aiKeys.secret) {
  console.error('DATABASE_URL and KEY_ENCRYPTION_SECRET must be set.');
  process.exit(2);
}
const pool = createPool(config.databaseUrl, { mode: config.databaseSsl, caFile: config.databaseSslCaFile });
const box = createSecretBox({ current: config.aiKeys.secret, previous: config.aiKeys.previousSecrets });
const result = await rotateAiKeys(pool, box);
await pool.end();
console.log(`key version ${box.keyVersion}: re-sealed ${result.resealed}, unreadable ${result.unreadable}, skipped (changed meanwhile) ${result.skipped}`);
process.exit(result.unreadable === 0 ? 0 : 1);
