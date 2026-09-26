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

  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'error';
    source?: string;
  } | null>(null);

  const executeCommand = async (commandText: string) => {
    if (!commandText.trim() || loading) return;
    setLoading(true);
    setStatusMessage(null);

    try {
      const result = await processArchitectureInstruction(commandText.trim());
      if (result.success) {
        setStatusMessage({
          text: result.actionsExecuted.join(' • ') || 'Architecture updated',
          type: 'success',
          source: result.source === 'gemini' ? 'Gemini AI' : 'Local Rule Engine',
        });
        setInput('');
      } else {
        setStatusMessage({
          text: result.error || 'Could not understand command',
          type: 'error',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        text: msg,
        type: 'error',
      });
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

  // Continuous speech recognition
  const startListening = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatusMessage({
        text: 'Speech recognition is not supported in this browser. Please use Chrome or Edge.',
        type: 'error',
      });
      return;
    }

    try {
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
        setInput(transcript.trim());
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
    if (input.trim()) {
      executeCommand(input.trim());
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
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 backdrop-blur-xl animate-pulse shadow-xl">
          <span>{micNotice}</span>
        </div>
      )}

      {/* Status banner */}
      {statusMessage && !micNotice && (
        <div
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium backdrop-blur-xl border animate-fade-in shadow-xl ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
              : 'bg-rose-950/80 text-rose-300 border-rose-800/80'
          }`}
        >
          <span>{statusMessage.text}</span>
          {statusMessage.source && (
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-900/80 text-slate-300 border border-slate-700/60">
              {statusMessage.source}
            </span>
          )}
        </div>
      )}

      {/* Suggestion Pills */}
      <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto max-w-full py-1 text-[11px] text-slate-400">
        <span className="text-slate-400 font-medium mr-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-400" /> Ideas:
        </span>
        <button
          onClick={() => handleSuggestion('What happens if Auth goes down?')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "What happens if Auth goes down?"
        </button>
        <button
          onClick={() => handleSuggestion('Simplify this for a non-technical person')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "Simplify this"
        </button>
        <button
          onClick={() => handleSuggestion('Put Redis between orders and postgres')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "Put Redis between orders and postgres"
        </button>
        <button
          onClick={() => handleSuggestion('Highlight the payment flow')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "Highlight payment flow"
        </button>
      </div>

      {/* Main Floating Input Bar with Integrated Mic */}
      <form
        onSubmit={handleSubmit}
        className="w-full flex items-center gap-2 p-1.5 pl-4 rounded-2xl bg-[#11141c]/90 border border-slate-800/90 hover:border-slate-700 backdrop-blur-2xl shadow-2xl transition-all group focus-within:border-amber-500/60 focus-within:ring-2 focus-within:ring-amber-500/20"
      >
        <div className="text-amber-400 flex items-center justify-center">
          <Command className="w-4 h-4 text-slate-400 group-focus-within:text-amber-400 transition-colors" />
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isListening
              ? 'Listening... speak now'
              : 'Describe architecture change or ask a question... (e.g. "What happens if Auth goes down?")'
          }
          disabled={loading}
          className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-50"
        />

        {/* Audio Mute/Unmute Toggle */}
        <button
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute voice responses' : 'Mute voice responses'}
          className={`p-2 rounded-xl transition-colors ${
            isMuted
              ? 'text-slate-500 hover:text-slate-400 hover:bg-slate-800/50'
              : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
          }`}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {/* Integrated Speech / Microphone Button */}
        <button
          type="button"
          onClick={toggleListening}
          title={isListening ? 'Stop listening and submit' : 'Click to speak (stays listening until stopped)'}
          className={`p-2 rounded-xl transition-all ${
            isListening
              ? 'bg-rose-500 text-white animate-pulse ring-4 ring-rose-500/30'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
          }`}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="flex items-center justify-center w-8 h-8 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold transition-all shadow-md shadow-amber-500/10"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
        </button>
      </form>
    </div>
  );
};
