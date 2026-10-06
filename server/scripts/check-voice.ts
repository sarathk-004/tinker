/**
 * Live check of the voice path with a real key and NO microphone: a Gemini text-to-speech model speaks a sentence, the audio goes
 * through OUR Gemini Live gateway exactly as the browser's would, and we expect the model to propose the right tool call.
 *   npm run check:voice          (reads GEMINI_API_KEY from server/.env; the key is never printed)
 * It proves: the endpoint and setup are accepted, 16 kHz PCM is understood, transcription events arrive, and the model calls
 * edit_diagram / ask_about_diagram with a sensible request. It changes nothing (no database).
 */
import { loadConfig } from '../src/infrastructure/config/config.ts';
import { createGeminiLiveGateway } from '../src/modules/voice/gemini-live.ts';
import type { LiveToolCall } from '../src/modules/voice/live-gateway.ts';
import { synthesizeSpeech, withTrailingSilence } from './support/speech.ts';

const config = loadConfig({ ...process.env, NODE_ENV: 'development' });
const key = config.ai.apiKey;
if (!key) {
  console.error('GEMINI_API_KEY is not set (put it in server/.env).');
  process.exit(2);
}
const scrub = (text: string) => text.split(key!).join('[key]');

const gateway = createGeminiLiveGateway({ apiKey: key, model: config.ai.liveModel });
const cases = [
  { say: 'Put Redis between Orders and PostgreSQL.', tool: 'edit_diagram', expect: [/redis/i, /orders/i, /postgres/i] },
  { say: 'What happens if Orders goes down?', tool: 'ask_about_diagram', expect: [/orders/i] },
];

let failures = 0;
console.log(`live model: ${config.ai.liveModel}`);
for (const c of cases) {
  const started = Date.now();
  try {
    const { pcm: speech, model: ttsModel } = await synthesizeSpeech(key, c.say);
    console.log(`speech: ${ttsModel}, ${(speech.length / 16000).toFixed(1)} s`);
    const transcripts: string[] = [];
    let call: LiveToolCall | undefined;
    const controller = new AbortController();
    const session = await gateway.open(
      {
        onTranscript: (t, f) => f && transcripts.push(t),
        onToolCalls: (calls) => (call ??= calls[0]),
        onToolCancelled: () => undefined,
        onClosed: (i) => console.log(`  provider closed: ${i.reason}`),
      },
      { componentNames: ['Orders', 'PostgreSQL', 'Web Client'], signal: controller.signal },
    );
    const opened = Date.now() - started;
    const bytes = withTrailingSilence(speech); // silence at the end so the model hears the end of the turn
    for (let i = 0; i < bytes.length; i += 3200) {
      session.sendAudio(bytes.subarray(i, Math.min(bytes.length, i + 3200)));
      await new Promise((r) => setTimeout(r, 60)); // a little faster than real time is fine
    }
    const sentAt = Date.now();
    while (!call && Date.now() - sentAt < 20_000) await new Promise((r) => setTimeout(r, 100));
    session.close();
    const ms = Date.now() - sentAt;
    const request = call && typeof call.args === 'object' && call.args ? String((call.args as any).request ?? (call.args as any).question ?? '') : '';
    const good = !!call && call.name === c.tool && c.expect.every((r) => r.test(request));
    if (!good) failures++;
    console.log(`${good ? 'PASS' : 'FAIL'}  said "${c.say}"  heard "${transcripts.join(' ').slice(0, 120)}"  ->  ${call ? `${call.name}("${request}")` : 'no tool call'}  (open ${opened} ms, answer ${ms} ms after the audio)`);
  } catch (error) {
    failures++;
    console.log(`FAIL  "${c.say}": ${scrub(error instanceof Error ? `${error.name}: ${error.message}` : String(error))}`);
  }
}
console.log(failures === 0 ? 'Voice live check passed.' : `${failures} voice check(s) failed. Share the lines above (they contain no key).`);
process.exit(failures === 0 ? 0 : 1);
