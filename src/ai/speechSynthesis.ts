// Web Speech Synthesis (Text-to-Speech) for tinker AI voice responses

export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/[*_#`~[\]]/g, '') // remove markdown symbols
    .replace(/https?:\/\/\S+/g, '') // remove links
    .replace(/[•\->→←↮]/g, ' ') // replace arrows/bullets with spaces
    .replace(/\s+/g, ' ')
    .trim();
}

export function speakText(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const isMuted = localStorage.getItem('tinker_tts_muted') === 'true';
  if (isMuted) return;

  const clean = cleanTextForSpeech(text);
  if (!clean) return;

  try {
    // Cancel any active speech to avoid queuing delays
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    // Prioritize natural sounding English voices
    const naturalVoice = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') ||
          v.name.includes('Google') ||
          v.name.includes('Samantha') ||
          v.name.includes('David') ||
          v.name.includes('Neural'))
    ) || voices.find((v) => v.lang.startsWith('en'));

    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Speech synthesis failed:', err);
  }
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
