// Runs in the browser's audio thread: hands each 128-sample block of the first channel to the page, which converts it to
// 16 kHz PCM for the voice session (see src/voice/pcm.ts). Nothing is played back.
class TinkerPcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('tinker-pcm-tap', TinkerPcmTap);
