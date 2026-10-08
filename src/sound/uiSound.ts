import { create } from 'zustand';

/**
 * Small interface sounds, made on the spot with the browser's own audio (no sound files): a few soft tones with a quick fade in and out.
 * Quiet by design, on by default, and one switch in Settings turns them off. They only ever play after the person has done something.
 */
export type Voice = 'tap' | 'pop' | 'lift' | 'drop' | 'chime' | 'deny' | 'tock' | 'tick' | 'thump' | 'check';

export interface Tone {
  hz: number;
  /** Glide to this pitch over the tone. */
  to?: number;
  ms: number;
  gain: number;
  wave?: OscillatorType;
  /** Start this many ms after the sound starts. */
  at?: number;
  /** Low-pass cut-off: lower is softer. */
  cut?: number;
  /** Fade-in, ms. */
  atk?: number;
}

export const VOICES: Record<Voice, readonly Tone[]> = {
  tap: [{ hz: 520, to: 400, ms: 55, gain: 0.03, cut: 1600, atk: 3 }],
  pop: [{ hz: 420, to: 760, ms: 70, gain: 0.05, cut: 2200, atk: 4 }],
  lift: [{ hz: 380, to: 520, ms: 110, gain: 0.04, wave: 'triangle', cut: 1500, atk: 12 }],
  drop: [{ hz: 330, to: 190, ms: 130, gain: 0.05, cut: 1200, atk: 5 }],
  chime: [
    { hz: 659, ms: 240, gain: 0.04, cut: 2600, atk: 6 },
    { hz: 988, ms: 300, gain: 0.032, cut: 2600, atk: 6, at: 85 },
  ],
  deny: [
    { hz: 230, to: 170, ms: 110, gain: 0.045, wave: 'triangle', cut: 900, atk: 6 },
    { hz: 200, to: 150, ms: 130, gain: 0.04, wave: 'triangle', cut: 900, atk: 6, at: 90 },
  ],
  tock: [{ hz: 310, to: 250, ms: 45, gain: 0.05, wave: 'triangle', cut: 1400, atk: 3 }],
  tick: [{ hz: 1250, ms: 22, gain: 0.025, cut: 3000, atk: 2 }],
  thump: [{ hz: 140, to: 70, ms: 150, gain: 0.08, cut: 700, atk: 4 }],
  check: [
    { hz: 523, ms: 110, gain: 0.04, cut: 2400, atk: 4 },
    { hz: 784, ms: 220, gain: 0.04, cut: 2400, atk: 4, at: 90 },
  ],
};

const KEY = 'tinker_sound';
const readEnabled = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

interface SoundState {
  enabled: boolean;
  setEnabled(on: boolean): void;
}

export const useSound = create<SoundState>((set) => ({
  enabled: readEnabled(),
  setEnabled(on) {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* storage unavailable: it applies for this visit only */
    }
    set({ enabled: on });
    if (on) playSound('pop');
  },
}));

type AudioCtor = typeof AudioContext;
let context: AudioContext | null = null;
const lastPlayed = new Map<Voice, number>();

function audio(): AudioContext | null {
  if (context) return context;
  const Ctor: AudioCtor | undefined = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/** Play one tone at `start` seconds on the audio clock. */
function schedule(ctx: AudioContext, tone: Tone, start: number): void {
  const t0 = start + (tone.at ?? 0) / 1000;
  const t1 = t0 + tone.ms / 1000;
  const osc = ctx.createOscillator();
  osc.type = tone.wave ?? 'sine';
  osc.frequency.setValueAtTime(tone.hz, t0);
  if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t1);
  const gain = ctx.createGain();
  const attack = Math.min((tone.atk ?? 4) / 1000, (tone.ms / 1000) * 0.6);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(tone.gain, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);
  let last: AudioNode = osc;
  if (tone.cut) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = tone.cut;
    osc.connect(filter);
    last = filter;
  }
  last.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** Play a sound if sounds are on. Never throws, never plays the same sound twice within 40 ms. Returns whether it played. */
export function playSound(voice: Voice): boolean {
  if (!useSound.getState().enabled) return false;
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  if (now - (lastPlayed.get(voice) ?? -1e9) < 40) return false;
  const ctx = audio();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime + 0.005;
    for (const tone of VOICES[voice]) schedule(ctx, tone, start);
    lastPlayed.set(voice, now);
    return true;
  } catch {
    return false;
  }
}

const SOUNDS = new Set<string>(Object.keys(VOICES));

/**
 * Every press on a button, menu item, tab or choice makes a soft tap, unless it says otherwise: `data-sound="lift"` picks another sound,
 * `data-sound="none"` stays quiet. Presses on the drawing canvas are left to what they do.
 */
export function installPressSounds(): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const el = target?.closest<HTMLElement>('button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="radio"]');
    if (!el || el.matches(':disabled, [aria-disabled="true"]')) return;
    const asked = el.closest<HTMLElement>('[data-sound]')?.dataset['sound'];
    if (asked === 'none') return;
    if (!asked && el.closest('.react-flow__pane, .react-flow__node, .react-flow__edge')) return;
    playSound(asked && SOUNDS.has(asked) ? (asked as Voice) : 'tap');
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
