import { PcmEncoder } from './pcm';

export interface MicCapture {
  stop(): void;
}

export class MicrophoneError extends Error {
  constructor(
    public readonly reason: 'denied' | 'unavailable' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'MicrophoneError';
  }
}

/** The audio-thread tap lives in public/tinker-pcm-tap.js (a static file, so the page's Content-Security-Policy stays strict). */
const WORKLET_URL = '/tinker-pcm-tap.js';

export type CaptureFactory = (onFrame: (frame: Uint8Array) => void) => Promise<MicCapture>;

/** Ask for the microphone (this must happen from a click) and stream 16 kHz PCM frames to `onFrame` until stopped. */
export const startMicrophone: CaptureFactory = async (onFrame) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
    throw new MicrophoneError('unsupported', 'This browser cannot capture audio.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicrophoneError('denied', 'Microphone access was blocked. Allow it in the browser to use voice.');
    throw new MicrophoneError('unavailable', 'No microphone is available.');
  }
  const context = new AudioContext();
  await context.audioWorklet.addModule(WORKLET_URL);
  const encoder = new PcmEncoder(context.sampleRate, onFrame);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'tinker-pcm-tap');
  node.port.onmessage = (event: MessageEvent<Float32Array>) => encoder.push(event.data);
  source.connect(node); // not connected to the speakers: nothing is played back
  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
};
