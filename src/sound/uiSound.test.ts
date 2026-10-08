import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}
const made = { oscillators: 0 };
class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = vi.fn();
  createOscillator() {
    made.oscillators += 1;
    return { type: 'sine', frequency: new FakeParam(), connect: (n: unknown) => n, start: vi.fn(), stop: vi.fn() };
  }
  createGain() {
    return { gain: new FakeParam(), connect: (n: unknown) => n };
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0 }, connect: (n: unknown) => n };
  }
}

let sound: typeof import('./uiSound');
beforeEach(async () => {
  vi.resetModules();
  made.oscillators = 0;
  (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeContext };
  (globalThis as unknown as { localStorage: unknown }).localStorage = (() => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  })();
  sound = await import('./uiSound');
});

describe('interface sounds', () => {
  it('every voice has at least one tone, all of them quiet and short', () => {
    for (const [name, tones] of Object.entries(sound.VOICES)) {
      expect(tones.length, name).toBeGreaterThan(0);
      for (const t of tones) {
        expect(t.gain, name).toBeLessThanOrEqual(0.1);
        expect(t.ms, name).toBeLessThan(400);
      }
    }
  });

  it('plays one oscillator per tone when on, and nothing when switched off', () => {
    expect(sound.playSound('chime')).toBe(true);
    expect(made.oscillators).toBe(2);
    sound.useSound.getState().setEnabled(false);
    const before = made.oscillators;
    expect(sound.playSound('deny')).toBe(false);
    expect(made.oscillators).toBe(before);
  });

  it('does not play the same sound twice in a rush', () => {
    expect(sound.playSound('tap')).toBe(true);
    expect(sound.playSound('tap')).toBe(false);
  });

  it('does nothing, without error, where there is no audio', async () => {
    vi.resetModules();
    (globalThis as unknown as { window: unknown }).window = {};
    const bare = await import('./uiSound');
    expect(bare.playSound('pop')).toBe(false);
  });
});
