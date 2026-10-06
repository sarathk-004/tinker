import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { speakResponseSchema } from '@tinker/shared';
import { ProviderError } from '../../src/modules/ai/providers/types.ts';
import { MAX_SPOKEN_CHARS, createFakeSpeech, createGeminiSpeech, speakableText } from '../../src/modules/voice/speech-provider.ts';
import { call, createDiagramFor, startHarness, type Harness, type TestUser } from '../support/harness.ts';

const KEY = 'AQ.test-secret-key-0123456789';

describe('speakableText', () => {
  it('removes markdown and the unavailable-notice, collapses spaces, and shortens long text at a sentence', () => {
    expect(speakableText('**Orders** feeds `PostgreSQL`.\n\n  Done.')).toBe('Orders feeds PostgreSQL. Done.');
    expect(speakableText('Orders feeds PostgreSQL. (The AI explanation is unavailable right now, so this is computed directly from the diagram.)')).toBe('Orders feeds PostgreSQL.');
    const long = `${'This is a sentence about the diagram. '.repeat(40)}`;
    const spoken = speakableText(long);
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(spoken.endsWith('.')).toBe(true);
  });
});

describe('Gemini speech provider', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const signal = () => new AbortController().signal;

  it('sends the key only in a header, refuses redirects, and returns the audio with its sample rate', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const speech = createGeminiSpeech({
      apiKey: KEY, models: ['tts-model'], voice: 'Kore',
      fetchImpl: (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAECAw==' } }] } }] })))) as unknown as typeof fetch,
    });
    await expect(speech.synthesize('hello', { signal: signal() })).resolves.toEqual({ audio: 'AAECAw==', sampleRate: 24000 });
    expect(seen!.url).not.toContain(KEY);
    expect((seen!.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(seen!.init.redirect).toBe('error');
    expect(JSON.parse(seen!.init.body as string).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  it('tries the next model when one is over quota or missing, but not when the request itself is refused', async () => {
    const urls: string[] = [];
    const reply = (status: number) => new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAAA' } }] } }] } : { error: { message: 'x' } }), { status });
    const sequence = (statuses: number[]) => createGeminiSpeech({
      apiKey: KEY, models: ['first', 'second'], voice: 'v',
      fetchImpl: (async (url: string) => (urls.push(url), reply(statuses[urls.length - 1] ?? 200))) as unknown as typeof fetch,
    });
    await expect(sequence([429, 200]).synthesize('x', { signal: new AbortController().signal })).resolves.toMatchObject({ sampleRate: 24000 });
    expect(urls.map((u) => /models\/(\w+):/.exec(u)![1])).toEqual(['first', 'second']);
    urls.length = 0;
    await expect(sequence([404, 200]).synthesize('x', { signal: new AbortController().signal })).resolves.toBeDefined();
    urls.length = 0;
    const refused = (await sequence([400, 200]).synthesize('x', { signal: new AbortController().signal }).catch((e) => e)) as ProviderError;
    expect(refused.kind).toBe('rejected');
    expect(urls).toHaveLength(1); // a bad request is not retried on another model
    urls.length = 0;
    const both = (await sequence([429, 429]).synthesize('x', { signal: new AbortController().signal }).catch((e) => e)) as ProviderError;
    expect(both.kind).toBe('rate_limited');
    expect(urls).toHaveLength(2);
  });

  it('maps failures to provider errors and never leaks the key', async () => {
    const kinds: Array<[number, string]> = [[429, 'rate_limited'], [503, 'unavailable'], [403, 'auth'], [400, 'rejected']];
    for (const [status, kind] of kinds) {
      const error = (await createGeminiSpeech({ apiKey: KEY, models: ['m'], voice: 'v', fetchImpl: ok({ error: { message: `bad ${KEY}` } }, status) }).synthesize('x', { signal: signal() }).catch((e) => e)) as ProviderError;
      expect(error.kind).toBe(kind);
      expect(JSON.stringify([error.message, error.detail])).not.toContain(KEY);
    }
    const noAudio = (await createGeminiSpeech({ apiKey: KEY, models: ['m'], voice: 'v', fetchImpl: ok({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }) }).synthesize('x', { signal: signal() }).catch((e) => e)) as ProviderError;
    expect(noAudio.kind).toBe('bad_output');
    const notBase64 = (await createGeminiSpeech({ apiKey: KEY, models: ['m'], voice: 'v', fetchImpl: ok({ candidates: [{ content: { parts: [{ inlineData: { data: '<script>' } }] } }] }) }).synthesize('x', { signal: signal() }).catch((e) => e)) as ProviderError;
    expect(notBase64.kind).toBe('bad_output');
    const aborted = new AbortController();
    aborted.abort();
    const timeout = (await createGeminiSpeech({ apiKey: KEY, models: ['m'], voice: 'v', fetchImpl: (async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }) as unknown as typeof fetch }).synthesize('x', { signal: aborted.signal }).catch((e) => e)) as ProviderError;
    expect(timeout.kind).toBe('timeout');
  });
});

describe('POST /v1/diagrams/{id}/ai/speak', () => {
  let h: Harness;
  let u: TestUser;
  const speech = createFakeSpeech();
  beforeAll(async () => {
    h = await startHarness({ speechProvider: speech });
    u = await h.newUser('listener');
  });
  afterAll(() => h.close());

  async function assistantMessage(user: TestUser, diagramId: string, version: number) {
    const ask = await call(h, user, 'POST', `/v1/diagrams/${diagramId}/ai/ask`, { question: 'What is connected?' });
    expect(ask.status).toBe(200);
    void version;
    return { id: ask.body.messages.find((m: { role: string }) => m.role === 'ASSISTANT').id as string, text: ask.body.answer as string };
  }

  it('reads the caller\'s own assistant message aloud, and only that', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const msg = await assistantMessage(u, diagram.diagramId, 1);
    const res = await call(h, u, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { messageId: msg.id });
    expect(res.status).toBe(200);
    expect(speakResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toEqual({ audio: 'AAAA', sampleRate: 24000, format: 'pcm_s16le' });
    expect(speech.calls.at(-1)).toBe(speakableTextOf(msg.text));
  });

  it('refuses ids that are not yours: another user, another diagram, a user message, an unknown id', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const msg = await assistantMessage(u, diagram.diagramId, 1);
    const other = await h.newUser('other');
    const { diagram: otherDiagram } = await createDiagramFor(h, other);
    expect((await call(h, other, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { messageId: msg.id })).status).toBe(404); // not their diagram
    expect((await call(h, other, 'POST', `/v1/diagrams/${otherDiagram.diagramId}/ai/speak`, { messageId: msg.id })).status).toBe(404); // someone else's message
    const { diagram: second } = await createDiagramFor(h, u);
    expect((await call(h, u, 'POST', `/v1/diagrams/${second.diagramId}/ai/speak`, { messageId: msg.id })).status).toBe(404); // another diagram
    const { rows } = await h.pool.query(`SELECT m.id FROM conversation_messages m WHERE m.role = 'USER' AND m.conversation_id IN (SELECT id FROM conversations WHERE diagram_id = $1) LIMIT 1`, [diagram.diagramId]);
    expect((await call(h, u, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { messageId: rows[0].id })).status).toBe(404); // what the user said is not read back
    expect((await call(h, u, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { messageId: '00000000-0000-4000-8000-000000000999' })).status).toBe(404);
    expect((await call(h, u, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { text: 'free text' })).status).toBe(400); // text is not accepted at all
    expect((await call(h, null, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { messageId: msg.id })).status).toBe(401);
  });

  it('provider failures are plain errors (the browser then uses its own voice)', async () => {
    const failing = createFakeSpeech([new ProviderError('unavailable', 'x')]);
    const h2 = await startHarness({ speechProvider: failing });
    try {
      const u2 = await h2.newUser('failing');
      const { diagram } = await createDiagramFor(h2, u2);
      const ask = await call(h2, u2, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/ask`, { question: 'hello?' });
      const id = ask.body.messages.find((m: { role: string }) => m.role === 'ASSISTANT').id;
      const res = await call(h2, u2, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { messageId: id });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('AI_PROVIDER_ERROR');
    } finally {
      await h2.close();
    }
  });

  it('without a speech provider the server says so and /v1/me advertises it', async () => {
    const h2 = await startHarness({});
    try {
      const u2 = await h2.newUser('nospeech');
      expect((await call(h2, u2, 'GET', '/v1/me')).body.features.speech).toBe(false);
      const { diagram } = await createDiagramFor(h2, u2);
      const ask = await call(h2, u2, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/ask`, { question: 'hello?' });
      const id = ask.body.messages.find((m: { role: string }) => m.role === 'ASSISTANT').id;
      expect((await call(h2, u2, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/speak`, { messageId: id })).status).toBe(503);
    } finally {
      await h2.close();
    }
    expect((await call(h, u, 'GET', '/v1/me')).body.features.speech).toBe(true);
  });
});

function speakableTextOf(text: string): string {
  return text.replace(/\([^)]*unavailable right now[^)]*\)/gi, '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
}
