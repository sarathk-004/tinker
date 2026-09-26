// Web Audio API wrapper to capture 16kHz PCM audio for Gemini Live

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  async start(onAudioData: (base64Pcm: string) => void): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        },
      });

      // Gemini Live expects 16kHz sample rate
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      // Using ScriptProcessor for compatibility and ease of raw PCM access
      // Buffer size 4096 gives us a nice chunk size (~250ms at 16kHz)
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Convert to Base64
        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < pcm16.length; i++) {
          view.setInt16(i * 2, pcm16[i], true); // true for little-endian
        }
        
        const base64 = btoa(
          String.fromCharCode(...new Uint8Array(buffer))
        );
        onAudioData(base64);
      };

      // Connect to a 0-gain node before destination to keep script processor active without speaker playback/feedback
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(muteGain);
      muteGain.connect(this.audioContext.destination);
    } catch (err) {
      console.error('Failed to start audio recording:', err);
      throw err;
    }
  }

  stop() {
    if (this.processor && this.source) {
      this.source.disconnect();
      this.processor.disconnect();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.audioContext = null;
  }
}
