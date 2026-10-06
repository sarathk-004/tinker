import { describe, expect, it, vi } from 'vitest';
import { interpretRequest } from '../../src/modules/ai/application/interpret.ts';
import { createFakeProvider, disabledProvider } from '../../src/modules/ai/providers/fake.ts';
import { createGeminiProvider, extractText } from '../../src/modules/ai/providers/gemini.ts';
import { ProviderError, type ProviderRequest } from '../../src/modules/ai/providers/types.ts';
import { ordersToPostgres } from './helpers.ts';

const SECRET = 'AIzaSy-TEST-SECRET-KEY-1234567890';
const request: ProviderRequest = { systemInstruction: 'sys', content: '<request>hi</request>', responseSchema: { type: 'object' } };
const signal = () => new AbortController().signal;
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const completed = (text: string) => ({ id: 'v1_x', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }], usage: { total_input_tokens: 10, total_output_tokens: 5 } });

describe('Gemini adapter: request', () => {
  it('sends the key ONLY in a header, never in the URL, and asks for structured JSON without storing the interaction', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return ok(completed('{"outcome":"UNSUPPORTED"}'));
    }) as unknown as typeof fetch;
    const provider = createGeminiProvider({ apiKey: SECRET, model: 'gemini-3.8-flash', fetchImpl });
    await provider.interpret(request, { signal: signal() });

    const { url, init } = calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(url).not.toContain(SECRET);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(SECRET);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'gemini-3.8-flash',
      input: request.content,
      system_instruction: 'sys',
      store: false,
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object' } },
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(init.redirect).toBe('error'); // never follow a redirect with the key attached
  });
});

describe('Gemini adapter: reasoning effort', () => {
  const bodyFor = async (thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high') => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return ok(completed('{"outcome":"UNSUPPORTED"}'));
    }) as unknown as typeof fetch;
    await createGeminiProvider({ apiKey: SECRET, model: 'm', fetchImpl, ...(thinkingLevel ? { thinkingLevel } : {}) }).interpret(request, { signal: signal() });
    return sent.generation_config as Record<string, unknown>;
  };

  it('asks for low reasoning effort by default (lower latency), configurable, and omitted when off', async () => {
    expect(await bodyFor()).toMatchObject({ thinking_level: 'low' });
    expect(await bodyFor('medium')).toMatchObject({ thinking_level: 'medium' });
    expect(await bodyFor('off')).not.toHaveProperty('thinking_level');
  });
});

describe('Gemini adapter: response', () => {
  const answer = (body: unknown) => createGeminiProvider({ apiKey: SECRET, model: 'm', fetchImpl: (async () => ok(body)) as unknown as typeof fetch });

  it('parses the documented shape and reports usage', async () => {
    const r = await answer(completed('{"outcome":"CLARIFY","question":"Which?"}')).interpret(request, { signal: signal() });
    expect(r.output).toEqual({ outcome: 'CLARIFY', question: 'Which?' });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('tolerates the alternative shapes seen in documentation and a markdown fence', async () => {
    const json = '{"outcome":"UNSUPPORTED"}';
    for (const body of [
      { status: 'completed', outputs: [{ type: 'text', text: json }] },
      { output_text: json },
      { interaction: { outputText: json } },
      { candidates: [{ content: { parts: [{ text: json }] } }] },
      completed('```json\n' + json + '\n```'),
    ]) {
      expect((await answer(body).interpret(request, { signal: signal() })).output).toEqual({ outcome: 'UNSUPPORTED' });
    }
    expect(extractText({ nothing: true })).toBeUndefined();
  });

  it.each([
    ['invalid JSON text', completed('not json at all')],
    ['no text anywhere', { status: 'completed', steps: [] }],
    ['non-completed status', { status: 'incomplete', steps: [] }],
  ])('bad_output for %s', async (_l, body) => {
    await expect(answer(body).interpret(request, { signal: signal() })).rejects.toMatchObject({ kind: 'bad_output' });
  });

  it('a cancelled or failed interaction counts as the provider being unavailable', async () => {
    await expect(answer({ status: 'failed' }).interpret(request, { signal: signal() })).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('Gemini adapter: errors', () => {
  const failing = (status: number, body = '{"error":{"status":"RESOURCE_EXHAUSTED","message":"quota for user text SECRET-USER-TEXT"}}') =>
    createGeminiProvider({ apiKey: SECRET, model: 'm', fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch });

  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'auth'],
    [400, 'rejected'],
  ])('HTTP %i -> %s', async (status, kind) => {
    await expect(failing(status).interpret(request, { signal: signal() })).rejects.toMatchObject({ kind });
  });

  it('error text and details never contain the key or provider-echoed user text', async () => {
    for (const status of [400, 401, 429, 500]) {
      const error = (await failing(status).interpret(request, { signal: signal() }).catch((e) => e)) as ProviderError;
      const everything = `${error.message} ${error.detail ?? ''} ${error.stack ?? ''}`;
      expect(everything).not.toContain(SECRET);
      expect(everything).not.toContain('SECRET-USER-TEXT');
    }
  });

  it('a network failure is "unavailable"; an aborted request is a timeout', async () => {
    const down = createGeminiProvider({ apiKey: SECRET, model: 'm', fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await expect(down.interpret(request, { signal: signal() })).rejects.toMatchObject({ kind: 'unavailable' });

    const controller = new AbortController();
    const hanging = createGeminiProvider({
      apiKey: SECRET,
      model: 'm',
      fetchImpl: ((_u: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch,
    });
    const pending = hanging.interpret(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('interpretRequest: parser first, then the provider under one deadline', () => {
  const doc = ordersToPostgres();
  const base = { doc, history: [], deadlineMs: 400 };
  const plan2 = (name: string, extra: Record<string, unknown>) => ({ outcome: 'COMMANDS', commands: [{ type: 'ADD_NODE', name, ...extra }] });
  const plan = (name = 'Redis') => ({ outcome: 'COMMANDS', commands: [{ type: 'ADD_NODE', name }] });

  it('plain commands never call the provider', async () => {
    const provider = createFakeProvider([{ output: plan() }]);
    const r = await interpretRequest({ ...base, text: 'Put Redis between Orders and PostgreSQL', provider });
    expect(r).toMatchObject({ kind: 'plan', source: 'PARSER' });
    expect(provider.calls).toHaveLength(0);
  });

  it('anything else goes to the provider and valid output becomes a plan', async () => {
    const provider = createFakeProvider([{ output: plan() }]);
    const r = await interpretRequest({ ...base, text: 'build me something useful', provider });
    expect(r).toEqual({ kind: 'plan', source: 'AI', steps: [{ type: 'ADD_NODE', name: 'Redis' }] });
    expect(provider.calls).toHaveLength(1);
  });

  it('CLARIFY and UNSUPPORTED outputs become clarifications', async () => {
    const q = await interpretRequest({ ...base, text: 'improve it', provider: createFakeProvider([{ output: { outcome: 'CLARIFY', question: 'Improve what?', options: ['Speed'] } }]) });
    expect(q).toEqual({ kind: 'clarify', source: 'AI', question: 'Improve what?', options: ['Speed'] });
    const u = await interpretRequest({ ...base, text: 'what is a monad', provider: createFakeProvider([{ output: { outcome: 'UNSUPPORTED', message: 'I only edit diagrams.' } }]) });
    expect(u).toMatchObject({ kind: 'clarify', question: 'I only edit diagrams.' });
  });

  it('an over-long OPTIONAL field (a model writing a paragraph in "technology") is dropped, not a failure', async () => {
    const provider = createFakeProvider([{ output: plan2('Redis', { technology: 'x'.repeat(300), relationship: 'y'.repeat(300) }) }]);
    const r = await interpretRequest({ ...base, text: 'make it faster', provider });
    expect(provider.calls).toHaveLength(1); // no retry needed
    expect(r).toEqual({ kind: 'plan', source: 'AI', steps: [{ type: 'ADD_NODE', name: 'Redis' }] });
  });

  it('...but an over-long NAME (or any required field) still fails validation', async () => {
    const provider = createFakeProvider([{ output: plan2('x'.repeat(300), {}) }]);
    await expect(interpretRequest({ ...base, deadlineMs: 5_000, text: 'make it faster', provider })).rejects.toMatchObject({ kind: 'bad_output' });
  });

  it('malformed output is retried ONCE, then fails as bad_output; nothing is executed', async () => {
    const provider = createFakeProvider([{ output: { outcome: 'COMMANDS', commands: [{ type: 'DROP_TABLE' }] } }]);
    await expect(interpretRequest({ ...base, deadlineMs: 5_000, text: 'do stuff', provider })).rejects.toMatchObject({ kind: 'bad_output' });
    expect(provider.calls).toHaveLength(2);
  });

  it('a transient failure is retried once and a good second answer wins', async () => {
    const provider = createFakeProvider([{ error: new ProviderError('unavailable', 'blip') }, { output: plan() }]);
    const r = await interpretRequest({ ...base, deadlineMs: 5_000, text: 'do stuff', provider });
    expect(r.kind).toBe('plan');
    expect(provider.calls).toHaveLength(2);
  });

  it('never more than one retry', async () => {
    const provider = createFakeProvider([{ error: new ProviderError('unavailable', 'blip') }]);
    await expect(interpretRequest({ ...base, deadlineMs: 5_000, text: 'do stuff', provider })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(provider.calls).toHaveLength(2);
  });

  it('non-transient failures are not retried', async () => {
    for (const kind of ['auth', 'rejected', 'timeout'] as const) {
      const provider = createFakeProvider([{ error: new ProviderError(kind, 'x') }]);
      await expect(interpretRequest({ ...base, text: 'do stuff', provider })).rejects.toMatchObject({ kind });
      expect(provider.calls, kind).toHaveLength(1);
    }
  });

  it('the TOTAL deadline holds even when the provider ignores cancellation: timeout, and the late answer is ignored', async () => {
    const provider = createFakeProvider([{ output: plan(), delayMs: 600, ignoreAbort: true }]);
    const started = Date.now();
    await expect(interpretRequest({ ...base, deadlineMs: 150, text: 'do stuff', provider })).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(450);
    await new Promise((r) => setTimeout(r, 700)); // the provider finishes late: nothing blows up
    expect(provider.calls).toHaveLength(1); // no retry after a timeout
  });

  it('no retry is attempted when too little of the deadline remains', async () => {
    const provider = createFakeProvider([{ error: new ProviderError('unavailable', 'blip'), }]);
    await expect(interpretRequest({ ...base, deadlineMs: 1_000, text: 'do stuff', provider })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(provider.calls).toHaveLength(1); // 1 s < the minimum retry budget
  });

  it('a hung first attempt is cut at half the budget and retried inside the total deadline', async () => {
    const provider = createFakeProvider([{ output: plan(), delayMs: 5_000 }, { output: plan() }]);
    const started = Date.now();
    const r = await interpretRequest({ ...base, deadlineMs: 600, minRetryBudgetMs: 100, text: 'do stuff', provider });
    expect(r).toMatchObject({ kind: 'plan', source: 'AI' });
    expect(provider.calls).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(600);
  });

  it('a hung retry still ends at the total deadline, with exactly two calls', async () => {
    const provider = createFakeProvider([{ output: plan(), delayMs: 5_000, ignoreAbort: true }, { output: plan(), delayMs: 5_000, ignoreAbort: true }]);
    const started = Date.now();
    await expect(interpretRequest({ ...base, deadlineMs: 400, minRetryBudgetMs: 100, text: 'do stuff', provider })).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(700);
    expect(provider.calls).toHaveLength(2);
  });

  it('exact repeats of a non-ADD step are dropped, repeated ADD_NODE steps are kept', async () => {
    const insert = { type: 'INSERT_BETWEEN', source: 'n1', target: 'n2', name: 'Redis' };
    const add = { type: 'ADD_NODE', name: 'Cache' };
    const provider = createFakeProvider([{ output: { outcome: 'COMMANDS', commands: [insert, insert, insert, add, add] } }]);
    const r = await interpretRequest({ ...base, deadlineMs: 5_000, text: 'do stuff', provider });
    expect(r.kind === 'plan' && r.steps.map((s) => s.type)).toEqual(['INSERT_BETWEEN', 'ADD_NODE', 'ADD_NODE']);
  });

  it('a disabled provider answers "disabled" only when the model is actually needed', async () => {
    const simple = await interpretRequest({ ...base, text: 'add Redis', provider: disabledProvider });
    expect(simple).toMatchObject({ kind: 'plan', source: 'PARSER' });
    await expect(interpretRequest({ ...base, text: 'make it faster', provider: disabledProvider })).rejects.toMatchObject({ kind: 'disabled' });
  });

  it('an oversized diagram asks for a precise command instead of sending it', async () => {
    const provider = createFakeProvider([{ output: plan() }]);
    const huge = ordersToPostgres();
    for (let i = 0; i < 480; i++) huge.graph.nodes.push({ id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, name: `Component number ${i} with a fairly long descriptive name to use budget`, kind: 'SERVICE', metadata: {} });
    const r = await interpretRequest({ ...base, doc: huge, text: 'make it faster', provider });
    expect(r).toMatchObject({ kind: 'clarify', source: 'AI' });
    expect(provider.calls).toHaveLength(0);
  });
});
