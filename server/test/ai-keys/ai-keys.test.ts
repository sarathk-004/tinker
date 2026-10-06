import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiKeyStatusSchema } from '@tinker/shared';
import { SecretBoxError, createSecretBox, decodeSecret } from '../../src/infrastructure/crypto/secret-box.ts';
import { checkGeminiKey } from '../../src/modules/ai-keys/ai-access.ts';
import { rotateAiKeys } from '../../src/modules/ai-keys/rotate.ts';
import { createFakeProvider } from '../../src/modules/ai/providers/fake.ts';
import { createFakeLive } from '../../src/modules/voice/fake-live.ts';
import { createFakeSpeech } from '../../src/modules/voice/speech-provider.ts';
import { call, cmd, createDiagramFor, startHarness, type Harness, type TestUser } from '../support/harness.ts';

const secret = () => randomBytes(32).toString('base64');
const KEY_A = 'AIzaSyAlice-0123456789abcdefghijklmnopQ1';
const KEY_B = 'AIzaSyBobbbb-0123456789abcdefghijklmnopZ9';

describe('secret box (AES-256-GCM)', () => {
  const aad = '11111111-1111-4111-8111-111111111111:gemini';

  it('round-trips, uses a fresh nonce every time, and never contains the plaintext', () => {
    const box = createSecretBox({ current: secret() });
    const a = box.seal(KEY_A, aad);
    const b = box.seal(KEY_A, aad);
    expect(box.open(a, aad)).toBe(KEY_A);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.ciphertext.toString('utf8')).not.toContain('AIza');
    expect(a.iv).toHaveLength(12);
    expect(a.tag).toHaveLength(16);
    expect(a.keyVersion).toMatch(/^[0-9a-f]{8}$/);
  });

  it('detects tampering, and a secret moved onto another user\'s record does not open (bound by AAD)', () => {
    const box = createSecretBox({ current: secret() });
    const sealed = box.seal(KEY_A, aad);
    const flipped = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext.map((byte, i) => (i === 0 ? byte ^ 1 : byte))) };
    expect(() => box.open(flipped, aad)).toThrowError(expect.objectContaining({ reason: 'TAMPERED' }));
    expect(() => box.open({ ...sealed, tag: Buffer.alloc(16) }, aad)).toThrowError(SecretBoxError);
    expect(() => box.open(sealed, '22222222-2222-4222-8222-222222222222:gemini')).toThrowError(expect.objectContaining({ reason: 'TAMPERED' }));
  });

  it('rotation: old secrets stay readable while listed as previous; an unknown key version is reported, not guessed', () => {
    const oldSecret = secret();
    const oldBox = createSecretBox({ current: oldSecret });
    const sealedOld = oldBox.seal(KEY_A, aad);
    const rotated = createSecretBox({ current: secret(), previous: [oldSecret] });
    expect(rotated.keyVersion).not.toBe(oldBox.keyVersion);
    expect(rotated.canOpen(sealedOld.keyVersion)).toBe(true);
    expect(rotated.open(sealedOld, aad)).toBe(KEY_A);
    expect(rotated.seal(KEY_A, aad).keyVersion).toBe(rotated.keyVersion); // new secrets use the current key
    const stranger = createSecretBox({ current: secret() });
    expect(() => stranger.open(sealedOld, aad)).toThrowError(expect.objectContaining({ reason: 'UNKNOWN_KEY_VERSION' }));
  });

  it('refuses secrets that are not exactly 32 random bytes in base64', () => {
    for (const bad of ['', 'short', 'A'.repeat(44), 'A'.repeat(43), randomBytes(16).toString('base64'), randomBytes(33).toString('base64'), `${secret()} `.replace(/=/, '!')]) {
      expect(() => decodeSecret(bad)).toThrowError(SecretBoxError);
    }
    expect(decodeSecret(secret())).toHaveLength(32);
  });
});

describe('checking a key with the provider', () => {
  const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;
  it('sends the key only in a header and maps answers: accepted, refused (the key is the problem), unavailable (not the person\'s fault)', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const spy = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response('{}'))) as unknown as typeof fetch;
    expect(await checkGeminiKey(KEY_A, spy)).toBe('valid');
    expect(seen!.url).not.toContain(KEY_A);
    expect((seen!.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY_A);
    expect(seen!.init.redirect).toBe('error');
    for (const status of [400, 401, 403]) expect(await checkGeminiKey(KEY_A, reply(status))).toBe('invalid');
    for (const status of [429, 500, 503]) expect(await checkGeminiKey(KEY_A, reply(status))).toBe('unavailable');
    expect(await checkGeminiKey(KEY_A, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe('unavailable');
  });
});

/** A fake that records which key each person's requests were run with. */
function recorder() {
  const used: Array<{ key: string; kind: 'provider' | 'live' | 'speech' }> = [];
  const build = (apiKey: string) => {
    const provider = createFakeProvider([{ output: { outcome: 'COMMANDS', commands: [{ type: 'ADD_NODE', name: 'FromModel' }] } }]);
    const wrapped = { ...provider, interpret: (...args: Parameters<typeof provider.interpret>) => (used.push({ key: apiKey, kind: 'provider' }), provider.interpret(...args)) };
    const live = createFakeLive();
    const liveOpen = live.open.bind(live);
    live.open = ((...args: Parameters<typeof liveOpen>) => (used.push({ key: apiKey, kind: 'live' }), liveOpen(...args))) as typeof live.open;
    const speech = createFakeSpeech();
    const synth = speech.synthesize.bind(speech);
    speech.synthesize = ((...args: Parameters<typeof synth>) => (used.push({ key: apiKey, kind: 'speech' }), synth(...args))) as typeof speech.synthesize;
    return { provider: Object.assign(Object.create(provider), { available: true, name: 'fake', calls: provider.calls, interpret: wrapped.interpret }), live, speech };
  };
  return { used, build };
}

const VAGUE = 'sprinkle some caching in front of the database';

describe('bring your own key (mode: user)', () => {
  let h: Harness;
  let alice: TestUser;
  let bob: TestUser;
  const rec = recorder();
  const logs: string[] = [];
  const SECRET = secret();
  beforeAll(async () => {
    h = await startHarness({
      env: { AI_KEY_MODE: 'user', KEY_ENCRYPTION_SECRET: SECRET, LOG_LEVEL: 'info' },
      logStream: { write: (line) => void logs.push(line) },
      checkAiKey: async (key) => (key.startsWith('AIza') ? 'valid' : key.startsWith('NOPE') ? 'invalid' : 'unavailable'),
      buildUserProviders: rec.build,
    });
    alice = await h.newUser('alice');
    bob = await h.newUser('bob');
  });
  afterAll(() => h.close());

  const put = (u: TestUser, apiKey: string) => call(h, u, 'PUT', '/v1/me/ai-key', { apiKey });
  const me = async (u: TestUser) => (await call(h, u, 'GET', '/v1/me')).body.features;

  it('without a key of their own: free-form AI, voice and spoken replies are off; plain commands and manual editing still work', async () => {
    expect(await me(alice)).toMatchObject({ aiModel: false, voice: false, speech: false, aiKey: { mode: 'user', source: 'NONE' } });
    const { diagram } = await createDiagramFor(h, alice, 'No key');
    const plain = await call(h, alice, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/command`, { expectedVersion: 1, input: { type: 'TEXT', text: 'add Orders' } }, { 'idempotency-key': crypto.randomUUID() });
    expect(plain.status).toBe(200);
    expect(plain.body.source).toBe('PARSER');
    const model = await call(h, alice, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/command`, { expectedVersion: plain.body.diagram.version, input: { type: 'TEXT', text: VAGUE } }, { 'idempotency-key': crypto.randomUUID() });
    expect(model.status).toBe(503);
    expect(model.body.error.code).toBe('AI_UNAVAILABLE');
    // advice still answers, computed from the graph
    const ask = await call(h, alice, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/ask`, { question: 'what is connected?' });
    expect(ask.status).toBe(200);
    expect(ask.body.source).toBe('ANALYZER');
  });

  it('saving a key: checked with the provider, stored encrypted, never returned; status shows only the last four characters', async () => {
    const res = await put(alice, KEY_A);
    expect(res.status).toBe(200);
    expect(aiKeyStatusSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ mode: 'user', source: 'USER', configured: true, last4: KEY_A.slice(-4) });
    expect(JSON.stringify(res.body)).not.toContain(KEY_A);
    const status = await call(h, alice, 'GET', '/v1/me/ai-key');
    expect(JSON.stringify(status.body)).not.toContain(KEY_A);
    // what the database holds
    const { rows } = await h.pool.query(`SELECT k.*, u.external_auth_id FROM user_api_keys k JOIN users u ON u.id = k.user_id WHERE u.external_auth_id = $1`, [alice.subject]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('AIzaSyAlice');
    expect(Buffer.from(rows[0].ciphertext).toString('latin1')).not.toContain('AIza');
    expect(Buffer.from(rows[0].ciphertext).toString('base64')).not.toContain(Buffer.from(KEY_A).toString('base64'));
    expect(rows[0]).toMatchObject({ key_last4: KEY_A.slice(-4), provider: 'gemini' });
    expect(rows[0].verified_at).not.toBeNull();
    expect(await me(alice)).toMatchObject({ aiModel: true, voice: true, speech: true, aiKey: { mode: 'user', source: 'USER' } });
  });

  it('the key never reaches the logs, and error answers never contain it', async () => {
    await put(bob, KEY_B);
    await put(bob, 'NOPE-this-is-not-a-valid-key-0000');
    await put(bob, 'short');
    const everything = logs.join('\n');
    for (const key of [KEY_A, KEY_B, 'NOPE-this-is-not-a-valid-key-0000', SECRET]) expect(everything).not.toContain(key);
    expect(everything).toContain('/v1/me/ai-key'); // the route is logged, the body is not
  });

  it('each person\'s requests run on THEIR key: typed commands, advice, spoken replies and voice, never each other\'s', async () => {
    rec.used.length = 0;
    const a = await createDiagramFor(h, alice, 'Alice AI');
    const b = await createDiagramFor(h, bob, 'Bob AI');
    const ra = await call(h, alice, 'POST', `/v1/diagrams/${a.diagram.diagramId}/ai/command`, { expectedVersion: 1, input: { type: 'TEXT', text: VAGUE } }, { 'idempotency-key': crypto.randomUUID() });
    const rb = await call(h, bob, 'POST', `/v1/diagrams/${b.diagram.diagramId}/ai/command`, { expectedVersion: 1, input: { type: 'TEXT', text: VAGUE } }, { 'idempotency-key': crypto.randomUUID() });
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(ra.body.source).toBe('AI');
    const keysUsed = rec.used.filter((u) => u.kind === 'provider').map((u) => u.key);
    expect(keysUsed).toEqual(expect.arrayContaining([KEY_A, KEY_B]));
    const aliceUses = rec.used.filter((u) => u.key === KEY_A).length;
    const bobUses = rec.used.filter((u) => u.key === KEY_B).length;
    expect(aliceUses).toBe(1);
    expect(bobUses).toBe(1);

    const msg = ra.body.messages.find((m: { role: string }) => m.role === 'ASSISTANT');
    const spoken = await call(h, alice, 'POST', `/v1/diagrams/${a.diagram.diagramId}/ai/speak`, { messageId: msg.id });
    expect(spoken.status).toBe(200);
    expect(rec.used.filter((u) => u.kind === 'speech').map((u) => u.key)).toEqual([KEY_A]);
    // Bob cannot read Alice's message aloud with his key (or at all)
    expect((await call(h, bob, 'POST', `/v1/diagrams/${a.diagram.diagramId}/ai/speak`, { messageId: msg.id })).status).toBe(404);
  });

  it('a key that Google refuses is not stored (422); when Google cannot be reached nothing is stored either (503); bad shapes are 400', async () => {
    const carol = await h.newUser('carol');
    const refused = await put(carol, 'NOPE-this-is-not-a-valid-key-0000');
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('API_KEY_INVALID');
    const down = await put(carol, 'unreachable-key-0000000000000000');
    expect(down.status).toBe(503);
    expect((await put(carol, 'short')).status).toBe(400);
    expect((await put(carol, 'has spaces and !!! in it 0000000000')).status).toBe(400);
    expect((await call(h, carol, 'PUT', '/v1/me/ai-key', { apiKey: KEY_A, extra: 1 })).status).toBe(400);
    const status = await call(h, carol, 'GET', '/v1/me/ai-key');
    expect(status.body).toMatchObject({ configured: false, source: 'NONE', last4: null });
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM user_api_keys k JOIN users u ON u.id = k.user_id WHERE u.external_auth_id = $1`, [carol.subject])).rows[0].n).toBe(0);
  });

  it('submitting keys is rate limited (5 a minute), so the endpoint cannot be used to test guessed keys', async () => {
    const dave = await h.newUser('dave');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await put(dave, `NOPE-guess-number-${i}-00000000000`)).status);
    expect(statuses.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('replacing a key replaces it; removing it deletes the row and switches the AI off again', async () => {
    const erin = await h.newUser('erin');
    await put(erin, KEY_A);
    const replaced = await put(erin, KEY_B);
    expect(replaced.body.last4).toBe(KEY_B.slice(-4));
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM user_api_keys k JOIN users u ON u.id = k.user_id WHERE u.external_auth_id = $1`, [erin.subject])).rows[0].n).toBe(1);
    rec.used.length = 0;
    const removed = await call(h, erin, 'DELETE', '/v1/me/ai-key');
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ configured: false, source: 'NONE', last4: null });
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM user_api_keys k JOIN users u ON u.id = k.user_id WHERE u.external_auth_id = $1`, [erin.subject])).rows[0].n).toBe(0);
    expect(await me(erin)).toMatchObject({ aiModel: false, aiKey: { source: 'NONE' } });
  });

  it('one person cannot see, use or remove another person\'s key', async () => {
    const status = await call(h, bob, 'GET', '/v1/me/ai-key');
    expect(status.body.last4).toBe(KEY_B.slice(-4)); // Bob sees his own
    const frank = await h.newUser('frank');
    const theirs = await call(h, frank, 'GET', '/v1/me/ai-key');
    expect(theirs.body).toMatchObject({ configured: false, last4: null });
    await call(h, frank, 'DELETE', '/v1/me/ai-key');
    expect((await call(h, bob, 'GET', '/v1/me/ai-key')).body.configured).toBe(true); // untouched
    expect((await call(h, null, 'GET', '/v1/me/ai-key')).status).toBe(401);
    expect((await call(h, null, 'PUT', '/v1/me/ai-key', { apiKey: KEY_A })).status).toBe(401);
  });

  it('a stored key copied onto someone else\'s row does not work (integrity bound to the owner), and is reported without the key', async () => {
    const gina = await h.newUser('gina');
    await call(h, gina, 'GET', '/v1/me');
    await put(alice, KEY_A);
    await h.pool.query(
      `INSERT INTO user_api_keys (user_id, provider, ciphertext, iv, auth_tag, key_version, key_last4)
       SELECT g.id, 'gemini', k.ciphertext, k.iv, k.auth_tag, k.key_version, k.key_last4
         FROM user_api_keys k JOIN users a ON a.id = k.user_id, users g WHERE a.external_auth_id = $1 AND g.external_auth_id = $2`,
      [alice.subject, gina.subject],
    );
    expect((await me(gina)).aiKey.source).toBe('NONE'); // Alice's ciphertext does not open as Gina's key
    expect(logs.join('\n')).toContain('stored api key unusable');
    expect(logs.join('\n')).not.toContain(KEY_A);
  });

  it("a person's key goes away with their account", async () => {
    const hank = await h.newUser('hank');
    await put(hank, KEY_B);
    const id = (await h.pool.query(`SELECT id FROM users WHERE external_auth_id = $1`, [hank.subject])).rows[0].id;
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM user_api_keys WHERE user_id = $1`, [id])).rows[0].n).toBe(1);
    // (there is no account-deletion feature yet, so remove what points at the user first, as one would)
    await h.pool.query(`DELETE FROM workspace_memberships WHERE user_id = $1`, [id]);
    await h.pool.query(`DELETE FROM workspaces WHERE created_by = $1`, [id]);
    await h.pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM user_api_keys WHERE user_id = $1`, [id])).rows[0].n).toBe(0);
  });
});

describe('key modes', () => {
  it('server mode (development default): everyone runs on the server key, and the key endpoints do not exist', async () => {
    const h = await startHarness({ aiProvider: createFakeProvider([{ output: { outcome: 'CLARIFY', question: 'which?' } }]) });
    try {
      const u = await h.newUser('srv');
      expect((await call(h, u, 'GET', '/v1/me')).body.features).toMatchObject({ aiModel: true, aiKey: { mode: 'server', source: 'SERVER' } });
      expect((await call(h, u, 'PUT', '/v1/me/ai-key', { apiKey: KEY_A })).status).toBe(404);
      expect((await call(h, u, 'DELETE', '/v1/me/ai-key')).status).toBe(404);
      expect((await call(h, u, 'GET', '/v1/me/ai-key')).body).toMatchObject({ mode: 'server', source: 'SERVER', configured: false });
    } finally {
      await h.close();
    }
  });

  it('user_or_server: their own key when they have one, otherwise the server\'s', async () => {
    const rec = recorder();
    const serverProvider = createFakeProvider([{ output: { outcome: 'CLARIFY', question: 'which?' } }]);
    const h = await startHarness({
      aiProvider: serverProvider,
      env: { AI_KEY_MODE: 'user_or_server', KEY_ENCRYPTION_SECRET: secret() },
      checkAiKey: async () => 'valid',
      buildUserProviders: rec.build,
    });
    try {
      const u = await h.newUser('either');
      expect((await call(h, u, 'GET', '/v1/me')).body.features.aiKey).toEqual({ mode: 'user_or_server', source: 'SERVER' });
      await call(h, u, 'PUT', '/v1/me/ai-key', { apiKey: KEY_A });
      expect((await call(h, u, 'GET', '/v1/me')).body.features.aiKey).toEqual({ mode: 'user_or_server', source: 'USER' });
      await call(h, u, 'DELETE', '/v1/me/ai-key');
      expect((await call(h, u, 'GET', '/v1/me')).body.features.aiKey).toEqual({ mode: 'user_or_server', source: 'SERVER' });
    } finally {
      await h.close();
    }
  });

  it('production defaults to user mode and refuses to start without the secret that seals the keys', async () => {
    const { loadConfig, ConfigError } = await import('../../src/infrastructure/config/config.ts');
    const prod = { NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com', DATABASE_URL: 'postgres://u:p@h/db', SUPABASE_URL: 'https://x.supabase.co' };
    expect(() => loadConfig(prod)).toThrowError(ConfigError);
    expect(() => loadConfig(prod)).toThrowError(/KEY_ENCRYPTION_SECRET/);
    expect(loadConfig({ ...prod, KEY_ENCRYPTION_SECRET: secret() }).aiKeys.mode).toBe('user');
    expect(loadConfig({ ...prod, AI_KEY_MODE: 'server' }).aiKeys.mode).toBe('server'); // an explicit choice by the operator
    expect(() => loadConfig({ ...prod, KEY_ENCRYPTION_SECRET: 'not-a-secret' })).toThrowError(/32 random bytes/);
    expect(() => loadConfig({ ...prod, KEY_ENCRYPTION_SECRET: secret(), KEY_ENCRYPTION_SECRET_PREVIOUS: 'nope' })).toThrowError(/KEY_ENCRYPTION_SECRET_PREVIOUS/);
    expect(loadConfig({ NODE_ENV: 'development' }).aiKeys.mode).toBe('server');
    expect(() => loadConfig({ NODE_ENV: 'development', AI_KEY_MODE: 'user' })).toThrowError(/KEY_ENCRYPTION_SECRET/);
  });
});

describe('voice runs on the person\'s own key', () => {
  it('the realtime session is opened with the key of the person who is talking', async () => {
    const rec = recorder();
    const h = await startHarness({
      env: { AI_KEY_MODE: 'user', KEY_ENCRYPTION_SECRET: secret() },
      checkAiKey: async () => 'valid',
      buildUserProviders: rec.build,
    });
    try {
      const u = await h.newUser('talker');
      const { diagram } = await createDiagramFor(h, u, 'Voice');
      const noKey = await h.app.injectWS('/v1/voice', { headers: { origin: 'http://localhost:5173' } });
      const messages: Array<{ type: string; code?: string }> = [];
      noKey.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString('utf8'))));
      noKey.send(JSON.stringify({ type: 'hello', token: u.token, diagramId: diagram.diagramId, version: 1 }));
      await new Promise((r) => setTimeout(r, 250));
      noKey.send(JSON.stringify({ type: 'start' }));
      await new Promise((r) => setTimeout(r, 250));
      expect(messages.find((m) => m.type === 'error')).toMatchObject({ code: 'AI_UNAVAILABLE' }); // no key: voice is off, nothing else breaks
      expect(rec.used).toEqual([]);

      await call(h, u, 'PUT', '/v1/me/ai-key', { apiKey: KEY_A });
      messages.length = 0;
      noKey.send(JSON.stringify({ type: 'start' }));
      await new Promise((r) => setTimeout(r, 400));
      expect(messages.some((m) => m.type === 'listening')).toBe(true);
      expect(rec.used).toEqual([{ key: KEY_A, kind: 'live' }]);
      noKey.close();
      void cmd;
    } finally {
      await h.close();
    }
  });
});

describe('rotating the master secret', () => {
  it('re-seals every key with the new secret; afterwards the old secret alone can no longer open them', async () => {
    const h = await startHarness({ env: { AI_KEY_MODE: 'user', KEY_ENCRYPTION_SECRET: secret() }, checkAiKey: async () => 'valid' });
    try {
      const oldSecret = secret();
      const oldBox = createSecretBox({ current: oldSecret });
      const u1 = await h.newUser('rot1');
      const u2 = await h.newUser('rot2');
      for (const u of [u1, u2]) await call(h, u, 'GET', '/v1/me');
      const ids = (await h.pool.query(`SELECT id, external_auth_id FROM users WHERE external_auth_id = ANY($1)`, [[u1.subject, u2.subject]])).rows;
      for (const [i, row] of ids.entries()) {
        const sealed = oldBox.seal(i === 0 ? KEY_A : KEY_B, `${row.id}:gemini`);
        await h.pool.query(`INSERT INTO user_api_keys (user_id, provider, ciphertext, iv, auth_tag, key_version, key_last4) VALUES ($1, 'gemini', $2, $3, $4, $5, 'xxxx')`, [row.id, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion]);
      }
      const newSecret = secret();
      const newBox = createSecretBox({ current: newSecret, previous: [oldSecret] });
      expect(await rotateAiKeys(h.pool, newBox, ids.map((r) => r.id))).toEqual({ resealed: 2, unreadable: 0, skipped: 0 });
      expect(await rotateAiKeys(h.pool, newBox, ids.map((r) => r.id))).toEqual({ resealed: 0, unreadable: 0, skipped: 0 }); // nothing left to do
      const onlyNew = createSecretBox({ current: newSecret });
      const rows = (await h.pool.query(`SELECT user_id, ciphertext, iv, auth_tag, key_version FROM user_api_keys WHERE user_id = ANY($1)`, [ids.map((r) => r.id)])).rows;
      expect(rows.map((r) => onlyNew.open({ ciphertext: r.ciphertext, iv: r.iv, tag: r.auth_tag, keyVersion: r.key_version }, `${r.user_id}:gemini`)).sort()).toEqual([KEY_A, KEY_B].sort());
      // a key sealed with a secret that is no longer configured is counted, not touched
      const lost = createSecretBox({ current: secret() }).seal(KEY_A, `${ids[0].id}:gemini`);
      await h.pool.query(`UPDATE user_api_keys SET ciphertext = $2, iv = $3, auth_tag = $4, key_version = $5 WHERE user_id = $1`, [ids[0].id, lost.ciphertext, lost.iv, lost.tag, lost.keyVersion]);
      expect(await rotateAiKeys(h.pool, newBox, ids.map((r) => r.id))).toEqual({ resealed: 0, unreadable: 1, skipped: 0 });
    } finally {
      await h.close();
    }
  });
});
