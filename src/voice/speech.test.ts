import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveVoice, pcmBase64ToFloat32, speakReply, speakable, stopSpeaking, useSpeechSettings } from './speech';

describe('choosing the voice', () => {
  it('automatic: the Gemini voice when the server has it, otherwise the browser voice', () => {
    expect(effectiveVoice(null, true)).toBe('gemini');
    expect(effectiveVoice(null, false)).toBe('browser');
  });

  it('an explicit choice is respected; Gemini that the server cannot provide falls back to the browser voice', () => {
    expect(effectiveVoice('browser', true)).toBe('browser'); // saving tokens
    expect(effectiveVoice('off', true)).toBe('off');
    expect(effectiveVoice('gemini', true)).toBe('gemini');
    expect(effectiveVoice('gemini', false)).toBe('browser');
  });
});

describe('audio and text helpers', () => {
  it('decodes base64 little-endian PCM to floats', () => {
    // samples: 0, 16384, -32768, 32767 (little endian)
    const bytes = new Uint8Array([0, 0, 0, 0x40, 0, 0x80, 0xff, 0x7f]);
    const base64 = btoa(String.fromCharCode(...bytes));
    const floats = pcmBase64ToFloat32(base64);
    expect(Array.from(floats).map((v) => Number(v.toFixed(4)))).toEqual([0, 0.5, -1, 1]);
  });

  it('ignores a dangling odd byte', () => {
    expect(pcmBase64ToFloat32(btoa(String.fromCharCode(1, 0, 7)))).toHaveLength(1);
  });

  it('removes markdown and the unavailable notice before speaking', () => {
    expect(speakable('**Orders** feeds `PostgreSQL`. (The AI explanation is unavailable right now, so this is computed.)')).toBe('Orders feeds PostgreSQL.');
  });
});

describe('speaking a reply', () => {
  const spoken: string[] = [];
  let cancelled = 0;

  beforeEach(() => {
    spoken.length = 0;
    cancelled = 0;
    const synth = {
      cancel: () => void cancelled++,
      speak: (u: { text: string; onend?: () => void }) => {
        spoken.push(u.text);
        queueMicrotask(() => u.onend?.());
      },
    };
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', class { onend?: () => void; onerror?: () => void; rate = 1; constructor(public text: string) {} });
    useSpeechSettings.setState({ saved: null, speaking: false, serverCanSpeak: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('with no server voice it uses the browser voice and does not ask the server', async () => {
    const fetchAudio = vi.fn();
    await speakReply({ text: 'Orders feeds PostgreSQL.', serverCanSpeak: false, fetchAudio });
    expect(spoken).toEqual(['Orders feeds PostgreSQL.']);
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(useSpeechSettings.getState().speaking).toBe(false);
  });

  it('browser voice chosen: the server is never asked (this is the save-tokens option)', async () => {
    useSpeechSettings.setState({ saved: 'browser' });
    const fetchAudio = vi.fn();
    await speakReply({ text: 'Hello there.', serverCanSpeak: true, fetchAudio });
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(spoken).toEqual(['Hello there.']);
  });

  it('off: nothing is spoken and nothing is requested', async () => {
    useSpeechSettings.setState({ saved: 'off' });
    const fetchAudio = vi.fn();
    await speakReply({ text: 'Hello there.', serverCanSpeak: true, fetchAudio });
    expect(spoken).toEqual([]);
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('the Gemini voice failing falls back to the browser voice, so the answer is never lost', async () => {
    const fetchAudio = vi.fn().mockRejectedValue(new Error('server down'));
    await speakReply({ text: 'Redis sits in the middle.', serverCanSpeak: true, fetchAudio });
    expect(fetchAudio).toHaveBeenCalledOnce();
    expect(spoken).toEqual(['Redis sits in the middle.']);
  });

  it('stopping cancels the current speech and clears the speaking flag', () => {
    useSpeechSettings.setState({ speaking: true });
    stopSpeaking();
    expect(useSpeechSettings.getState().speaking).toBe(false);
  });

  it('empty or whitespace replies are not spoken', async () => {
    await speakReply({ text: ' ** ', serverCanSpeak: false, fetchAudio: vi.fn() });
    expect(spoken).toEqual([]);
  });
});
