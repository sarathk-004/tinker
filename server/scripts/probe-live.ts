/**
 * Probe of the Gemini Live endpoint (development aid for I7). Connects, sends a setup message and prints the SHAPE of what comes
 * back (message keys, close codes), so the adapter follows what the real endpoint does and not a summary of the docs.
 *   npm run probe:live -w @tinker/server        (PROBE_MODELS=a,b to try several models)
 * The key is read from the environment and never printed.
 */
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('GEMINI_API_KEY is not set (server/.env).');
  process.exit(2);
}
const base = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const models = (process.env.PROBE_MODELS ?? 'gemini-3.8-live').split(',').map((m) => m.trim()).filter(Boolean);

const scrub = (text: string) => text.split(key).join('[key]');
const shape = (value: unknown, depth = 0): unknown => {
  if (Array.isArray(value)) return value.length === 0 ? [] : [shape(value[0], depth + 1), value.length > 1 ? `(+${value.length - 1})` : undefined].filter((x) => x !== undefined);
  if (value && typeof value === 'object') {
    if (depth > 3) return '{…}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'data' ? `<${String(v).length} chars>` : shape(v, depth + 1)]));
  }
  return typeof value === 'string' && value.length > 60 ? `${value.slice(0, 60)}…` : value;
};

async function probe(model: string, setup: Record<string, unknown>, label: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`${base}?key=${encodeURIComponent(key!)}`);
    const timer = setTimeout(() => (console.log(`[${label}] ${model}: timeout after 8 s`), ws.close(), resolve()), 8000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ setup: { model: `models/${model}`, ...setup } })));
    ws.addEventListener('message', async (event) => {
      const raw = typeof event.data === 'string' ? event.data : event.data instanceof Blob ? await event.data.text() : String(event.data);
      try {
        console.log(`[${label}] ${model}: message`, JSON.stringify(shape(JSON.parse(raw))));
        if (raw.includes('setupComplete')) (clearTimeout(timer), ws.close(), resolve());
      } catch {
        console.log(`[${label}] ${model}: non-JSON message (${raw.length} chars)`);
      }
    });
    ws.addEventListener('close', (event) => {
      clearTimeout(timer);
      console.log(`[${label}] ${model}: closed code=${event.code} reason=${scrub(event.reason).slice(0, 200)}`);
      resolve();
    });
    ws.addEventListener('error', () => console.log(`[${label}] ${model}: socket error`));
  });
}

const tools = [{ functionDeclarations: [{ name: 'edit_diagram', description: 'Edit the diagram', parameters: { type: 'OBJECT', properties: { request: { type: 'STRING' } }, required: ['request'] } }] }];
for (const model of models) {
  await probe(model, { generationConfig: { responseModalities: ['AUDIO'] }, inputAudioTranscription: {}, tools }, 'generationConfig.responseModalities');
}
