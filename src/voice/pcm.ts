/** What the server expects (shared/src/voice.ts): 16-bit little-endian PCM, 16 kHz, mono, in frames of about 100 ms. */
export const TARGET_RATE = 16_000;
export const FRAME_SAMPLES = 1_600;

/**
 * Streaming converter from the microphone's native float samples (any rate) to 16 kHz Int16 frames. Linear interpolation is
 * plenty for speech. Pure and framework-free so it can be tested without audio hardware.
 */
export class PcmEncoder {
  private input: number[] = [];
  /** Position of the next output sample, in input-sample units, relative to `input[0]`. */
  private position = 0;
  private readonly step: number;
  private frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;

  constructor(
    inputRate: number,
    private readonly onFrame: (frame: Uint8Array) => void,
  ) {
    this.step = inputRate / TARGET_RATE;
  }

  push(block: Float32Array): void {
    for (let i = 0; i < block.length; i++) this.input.push(block[i]!);
    while (this.position + 1 < this.input.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const a = this.input[index]!;
      const b = this.input[index + 1]!;
      this.emit(a + (b - a) * fraction);
      this.position += this.step;
    }
    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.input = this.input.slice(consumed);
      this.position -= consumed;
    }
  }

  private emit(sample: number): void {
    const clamped = Math.max(-1, Math.min(1, sample));
    this.frame[this.filled++] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    if (this.filled === FRAME_SAMPLES) {
      this.onFrame(new Uint8Array(this.frame.buffer.slice(0)));
      this.frame = new Int16Array(FRAME_SAMPLES);
      this.filled = 0;
    }
  }
}
