import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, ArrowRight, Loader2, Command, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { processArchitectureInstruction } from '../ai/orchestrator';

interface CommandBarProps {
  onOpenSettings?: () => void;
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
    setIsMuted(localStorage.getItem('tinker_tts_muted') === 'true');
  }, []);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    localStorage.setItem('tinker_tts_muted', String(next));
    if (next && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const executeCommand = async (commandText: string) => {
    if (!commandText.trim() || loading) return;
    setLoading(true);
    setMicNotice(`Thinking with Gemini 3.8 Flash...`);

    try {
      const result = await processArchitectureInstruction(commandText.trim());
      if (result.success) {
        setInput('');
        setMicNotice(null);
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

  // Speech recognition: keeps listening until user presses Stop Mic
  const accumulatedTranscriptRef = useRef('');
  const isListeningRef = useRef(false);

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
      setInput('');
      isListeningRef.current = true;
      setIsListening(true);
      setMicNotice('Listening continuously... Click mic when finished to generate.');

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript + ' ';
        }
        const clean = transcript.trim();
        accumulatedTranscriptRef.current = clean;
        setInput(clean);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.warn('SpeechRecognition error:', event.error);
        }
      };

      recognition.onend = () => {
        // Keep listening until user explicitly presses stop mic
        if (isListeningRef.current) {
          try {
            recognition.start();
          } catch (_) {
            // Already restarted
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('Failed to start speech recognition:', err);
      isListeningRef.current = false;
      setIsListening(false);
      setMicNotice(null);
    }
  };

  const stopListening = () => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    setMicNotice(null);
    const spokenText = accumulatedTranscriptRef.current || input;
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

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isListening) {
      stopListening();
      return;
    }
    await executeCommand(input);
  };

  const handleSuggestion = (prompt: string) => {
    setInput(prompt);
    executeCommand(prompt);
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4 flex flex-col items-center gap-2 select-none">
      {/* Listening notification */}
      {micNotice && (
        <div className="flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-mono bg-white text-[#26251e] border border-[#e6e5e0]">
          <span className="w-2 h-2 rounded-full bg-[#f54e00] animate-pulse" />
          <span>{micNotice}</span>
        </div>
      )}

      {/* Suggestion Pills - Cursor subtle hairlines */}
      <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto max-w-full py-1 text-[11px] text-[#5a5852]">
        <span className="text-[#807d72] font-medium mr-1 flex items-center gap-1 font-mono">
          <Sparkles className="w-3 h-3 text-[#f54e00]" /> Prompts:
        </span>
        <button
          onClick={() => handleSuggestion('What happens if Auth goes down?')}
          className="px-2.5 py-1 rounded-md bg-white hover:bg-[#fafaf7] hover:text-[#26251e] border border-[#e6e5e0] hover:border-[#cfcdc4] transition-all whitespace-nowrap"
        >
          "What happens if Auth goes down?"
        </button>
        <button
          onClick={() => handleSuggestion('Put Redis between orders and postgres')}
          className="px-2.5 py-1 rounded-md bg-white hover:bg-[#fafaf7] hover:text-[#26251e] border border-[#e6e5e0] hover:border-[#cfcdc4] transition-all whitespace-nowrap"
        >
          "Put Redis between orders & DB"
        </button>
        <button
          onClick={() => handleSuggestion('Highlight the payment flow')}
          className="px-2.5 py-1 rounded-md bg-white hover:bg-[#fafaf7] hover:text-[#26251e] border border-[#e6e5e0] hover:border-[#cfcdc4] transition-all whitespace-nowrap"
        >
          "Highlight payment flow"
        </button>
      </div>

      {/* Main Floating Input Bar with Cursor 8px rounded card */}
      <form
        onSubmit={handleSubmit}
        className="w-full flex items-center gap-2 p-1.5 pl-3.5 rounded-md bg-white border border-[#e6e5e0] hover:border-[#cfcdc4] transition-all group focus-within:border-[#26251e]"
      >
        <div className="flex items-center justify-center">
          <Command className="w-4 h-4 text-[#807d72] group-focus-within:text-[#26251e] transition-colors" />
        </div>

        {isListening ? (
          <div className="flex-1 flex items-center gap-2 py-1 select-none overflow-hidden">
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="w-1.5 h-3 bg-[#f54e00] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-4 bg-[#f54e00] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-3 bg-[#f54e00] rounded-full animate-bounce"></span>
            </div>
            <span className="text-xs font-mono font-medium text-[#26251e] truncate">
              {input ? input : 'Recording voice... Click mic to submit'}
            </span>
          </div>
        ) : (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Ask an architecture question or command (e.g. "Add Redis cache", "What happens if Auth goes down?")...'
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-[#26251e] placeholder-[#807d72] focus:outline-none disabled:opacity-50 font-sans"
          />
        )}

        {/* Audio Mute/Unmute */}
        <button
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute voice responses' : 'Mute voice responses'}
          className={`p-1.5 rounded-md transition-colors ${
            isMuted
              ? 'text-[#807d72] hover:text-[#26251e] hover:bg-[#fafaf7]'
              : 'text-[#26251e] hover:bg-[#fafaf7]'
          }`}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {/* Integrated Speech / Microphone */}
        <button
          type="button"
          onClick={toggleListening}
          title={isListening ? 'Stop listening and submit' : 'Click to speak'}
          className={`p-1.5 rounded-md transition-all ${
            isListening
              ? 'bg-[#f54e00] text-white animate-pulse'
              : 'bg-[#fafaf7] border border-[#e6e5e0] text-[#26251e] hover:bg-[#efeee8]'
          }`}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Submit Button - Signature Cursor Orange (8px rounded) */}
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-[#f54e00] hover:bg-[#d04200] disabled:bg-[#e6e5e0] disabled:text-[#a09c92] text-white font-medium transition-all"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
        </button>
      </form>
    </div>
  );
};
