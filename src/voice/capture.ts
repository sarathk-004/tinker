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

/** Runs in the audio thread: hands each 128-sample block of the first channel to the page. */
const WORKLET_SOURCE = `
class TinkerPcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('tinker-pcm-tap', TinkerPcmTap);
`;

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
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
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
