import React, { useState, useEffect, useRef } from 'react';
import { processArchitectureInstruction } from '../ai/orchestrator';
import { Sparkles, ArrowRight, Loader2, Command, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { stopSpeaking } from '../ai/speechSynthesis';

interface CommandBarProps {
  onOpenSettings: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = () => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const storedMute = localStorage.getItem('tinker_tts_muted') === 'true';
    setIsMuted(storedMute);
  }, []);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    localStorage.setItem('tinker_tts_muted', String(next));
    if (next) {
      stopSpeaking();
    }
  };

  const executeCommand = async (commandText: string) => {
    if (!commandText.trim() || loading) return;
    setLoading(true);

    try {
      const result = await processArchitectureInstruction(commandText.trim());
      if (result.success) {
        setInput('');
      } else if (result.error) {
        setMicNotice(result.error);
        setTimeout(() => setMicNotice(null), 3500);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMicNotice(msg);
      setTimeout(() => setMicNotice(null), 3500);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isListening) {
      stopListening();
    }
    await executeCommand(input);
  };

  const handleSuggestion = (prompt: string) => {
    setInput(prompt);
    executeCommand(prompt);
  };

  // Continuous speech recognition without live text preview
  const accumulatedTranscriptRef = useRef('');

  const startListening = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicNotice('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      setTimeout(() => setMicNotice(null), 4000);
      return;
    }

    try {
      accumulatedTranscriptRef.current = '';
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setMicNotice('🎙️ Listening... Wait 1 second before speaking. Click mic again when done.');
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript + ' ';
        }
        // Save silently without writing live preview to input
        accumulatedTranscriptRef.current = transcript.trim();
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.warn('SpeechRecognition error:', event.error);
          setIsListening(false);
          setMicNotice(null);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setMicNotice(null);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('Failed to start speech recognition:', err);
      setIsListening(false);
      setMicNotice(null);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    setMicNotice(null);
    const spokenText = accumulatedTranscriptRef.current;
    if (spokenText && spokenText.trim()) {
      executeCommand(spokenText.trim());
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4 flex flex-col items-center gap-2 select-none">
      {/* Listening notification / wait banner */}
      {micNotice && (
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-[#00ed64]/15 text-[#00ed64] border border-[#00ed64]/30 backdrop-blur-xl animate-pulse shadow-xl">
          <span>{micNotice}</span>
        </div>
      )}

      {/* Suggestion Pills - MongoDB pill-tab style */}
      <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto max-w-full py-1 text-[11px] text-[#a8b3bc]">
        <span className="text-[#a8b3bc] font-medium mr-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-[#00ed64]" /> Ideas:
        </span>
        <button
          onClick={() => handleSuggestion('What happens if Auth goes down?')}
          className="px-3 py-1 rounded-full bg-[#002636] hover:bg-[#003d4f] hover:text-white border border-[#1c2d38] hover:border-[#00ed64]/40 transition-all whitespace-nowrap"
        >
          "What happens if Auth goes down?"
        </button>
        <button
          onClick={() => handleSuggestion('Simplify this for a non-technical person')}
          className="px-3 py-1 rounded-full bg-[#002636] hover:bg-[#003d4f] hover:text-white border border-[#1c2d38] hover:border-[#00ed64]/40 transition-all whitespace-nowrap"
        >
          "Simplify this"
        </button>
        <button
          onClick={() => handleSuggestion('Put Redis between orders and postgres')}
          className="px-3 py-1 rounded-full bg-[#002636] hover:bg-[#003d4f] hover:text-white border border-[#1c2d38] hover:border-[#00ed64]/40 transition-all whitespace-nowrap"
        >
          "Put Redis between orders & DB"
        </button>
        <button
          onClick={() => handleSuggestion('Highlight the payment flow')}
          className="px-3 py-1 rounded-full bg-[#002636] hover:bg-[#003d4f] hover:text-white border border-[#1c2d38] hover:border-[#00ed64]/40 transition-all whitespace-nowrap"
        >
          "Highlight payment flow"
        </button>
      </div>

      {/* Main Floating Input Bar with MongoDB pill shape */}
      <form
        onSubmit={handleSubmit}
        className="w-full flex items-center gap-2 p-1.5 pl-4 rounded-full bg-[#001e2b]/95 border border-[#1c2d38] hover:border-[#243846] backdrop-blur-2xl shadow-2xl transition-all group focus-within:border-[#00ed64] focus-within:ring-2 focus-within:ring-[#00ed64]/20"
      >
        <div className="flex items-center justify-center">
          <Command className="w-4 h-4 text-[#5c6c7a] group-focus-within:text-[#00ed64] transition-colors" />
        </div>

        {isListening ? (
          <div className="flex-1 flex items-center gap-2.5 py-1 select-none">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-3 bg-[#00ed64] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-5 bg-[#00ed64] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-3 bg-[#00ed64] rounded-full animate-bounce"></span>
            </div>
            <span className="text-xs font-semibold text-[#00ed64] tracking-wide">
              Listening to voice... Click mic to submit
            </span>
          </div>
        ) : (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Describe architecture change or ask a question... (e.g. "What happens if Auth goes down?")'
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-white placeholder-[#5c6c7a] focus:outline-none disabled:opacity-50"
          />
        )}

        {/* Audio Mute/Unmute Toggle */}
        <button
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute voice responses' : 'Mute voice responses'}
          className={`p-2 rounded-full transition-colors ${
            isMuted
              ? 'text-[#5c6c7a] hover:text-white hover:bg-[#002636]'
              : 'text-[#00ed64] hover:text-[#00ed64] hover:bg-[#00ed64]/10'
          }`}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {/* Integrated Speech / Microphone Button */}
        <button
          type="button"
          onClick={toggleListening}
          title={isListening ? 'Stop listening and submit' : 'Click to speak (stays listening until stopped)'}
          className={`p-2 rounded-full transition-all ${
            isListening
              ? 'bg-rose-500 text-white animate-pulse ring-4 ring-rose-500/30'
              : 'bg-[#002636] border border-[#1c2d38] text-[#00ed64] hover:bg-[#003d4f] hover:text-white'
          }`}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Submit Button - MongoDB Signature Green Pill */}
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-[#00ed64] hover:bg-[#00b545] disabled:bg-[#002636] disabled:text-[#5c6c7a] text-[#001e2b] font-bold transition-all shadow-md shadow-[#00ed64]/10"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#001e2b]" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
        </button>
      </form>
    </div>
  );
};
