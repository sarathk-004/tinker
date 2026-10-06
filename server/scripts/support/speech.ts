/** Test speech for the live voice checks: a Gemini text-to-speech model reads a sentence, returned as 16 kHz mono Int16 PCM. */
export async function synthesizeSpeech(key: string, text: string): Promise<{ pcm: Int16Array; model: string }> {
  const scrub = (value: string) => value.split(key).join('[key]');
  const list = (await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })).json()) as { models?: Array<{ name: string }> };
  const candidates = (list.models ?? []).map((m) => m.name.replace('models/', '')).filter((n) => /tts/i.test(n));
  if (candidates.length === 0) throw new Error('no text-to-speech model is available to this key');
  let lastError = '';
  for (const model of candidates) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
      }),
    });
    const json = (await res.json()) as any;
    const part = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part) {
      lastError = `${model}: HTTP ${res.status} ${scrub(JSON.stringify(json?.error?.message ?? json).slice(0, 160))}`;
      continue;
    }
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000);
    const bytes = Buffer.from(part.inlineData.data, 'base64');
    const source = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const out = new Int16Array(Math.floor((source.length * 16000) / rate));
    for (let i = 0; i < out.length; i++) {
      const pos = (i * rate) / 16000;
      const a = source[Math.floor(pos)] ?? 0;
      const b = source[Math.min(source.length - 1, Math.floor(pos) + 1)] ?? a;
      out[i] = a + (b - a) * (pos - Math.floor(pos));
    }
    return { pcm: out, model };
  }
  throw new Error(`text-to-speech failed (${lastError})`);
}

/** Speech followed by silence (so the model hears the end of the turn), as bytes ready to stream in 100 ms frames. */
export function withTrailingSilence(speech: Int16Array, seconds = 2): Uint8Array {
  const audio = new Int16Array(speech.length + Math.round(16000 * seconds));
  audio.set(speech);
  return new Uint8Array(audio.buffer);
}
