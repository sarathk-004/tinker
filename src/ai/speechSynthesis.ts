// Advanced Natural Speech Synthesis for Tinker AI Voice
// Provides human-like inflection, neural voice selection, and prosody modulation

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

function initVoices(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const loadBestVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;
    voicesLoaded = true;

    // Rank voices by natural human quality
    // Tier 1: Windows/Edge Natural Neural voices (exceptionally human-like)
    const tier1 = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Jenny Online (Natural)') ||
          v.name.includes('Aria Online (Natural)') ||
          v.name.includes('Christopher Online (Natural)') ||
          v.name.includes('Guy Online (Natural)') ||
          v.name.includes('Natural'))
    );

    // Tier 2: Google & Apple Enhanced natural voices
    const tier2 = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Google US English') ||
          v.name.includes('Google UK English Female') ||
          v.name.includes('Samantha (Enhanced)') ||
          v.name.includes('Ava') ||
          v.name.includes('Neural') ||
          v.name.includes('Enhanced'))
    );

    // Tier 3: Any English voice with pleasant tone
    const tier3 = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Samantha') ||
          v.name.includes('Google') ||
          v.name.includes('David') ||
          v.name.includes('Zira'))
    );

    const fallback = voices.find((v) => v.lang.startsWith('en')) || voices[0];

    cachedVoice = tier1 || tier2 || tier3 || fallback;
  };

  loadBestVoice();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadBestVoice;
  }
}

// Initialize immediately
initVoices();

export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/[*_#`~[\]]/g, '') // remove markdown formatting
    .replace(/https?:\/\/\S+/g, '') // remove links
    .replace(/[•\->→←↮]/g, ' ') // replace arrow and bullet markers
    .replace(/\(.*?\)/g, '') // remove parenthetical node IDs e.g. (api_gw)
    .replace(/node_[a-z0-9_]+/gi, '') // remove raw technical IDs
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filter out repetitive and robotic diagram mutation lists
 * (e.g. "Added Web Client (client), Connected client -> api_gw")
 */
export function sanitizeSpeechResponse(text: string): string | null {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return null;

  // Check if text is just a list of primitive diagram actions
  const isOnlyActionList =
    /^(?:(?:Added|Removed|Connected|Disconnected|Inserted|Renamed|Highlighted)\s+[^,.]+(?:[,.]|\s*and\s*)*)+$/i.test(
      cleaned
    );

  if (isOnlyActionList) {
    // Return a short, natural human confirmation instead of reciting every node ID
    return 'Updated.';
  }

  // If it's a substantive answer or question explanation, return it directly
  return cleaned;
}

export function speakText(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const isMuted = localStorage.getItem('tinker_tts_muted') === 'true';
  if (isMuted) return;

  const spokenContent = sanitizeSpeechResponse(text);
  if (!spokenContent) return;

  try {
    window.speechSynthesis.cancel();

    if (!voicesLoaded || !cachedVoice) {
      initVoices();
    }

    // Split into sentences for human conversational modulation and micro-cadence
    const sentences = spokenContent
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    sentences.forEach((sentence, index) => {
      const utterance = new SpeechSynthesisUtterance(sentence);

      if (cachedVoice) {
        utterance.voice = cachedVoice;
      }

      // Humanized modulation:
      // Conversational rate (1.04) feels responsive without being rushed
      utterance.rate = 1.04;

      // Slight question pitch inflection
      if (sentence.endsWith('?')) {
        utterance.pitch = 1.08;
      } else if (index === sentences.length - 1) {
        // Natural statement completion cadence
        utterance.pitch = 0.98;
      } else {
        utterance.pitch = 1.02;
      }

      window.speechSynthesis.speak(utterance);
    });
  } catch (err) {
    console.warn('Natural speech synthesis failed:', err);
  }
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
