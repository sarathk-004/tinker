import React, { useState, useEffect } from 'react';
import { processArchitectureInstruction } from '../ai/orchestrator';
import { Sparkles, ArrowRight, Loader2, Command } from 'lucide-react';
import { VoiceControl } from './VoiceControl';

interface CommandBarProps {
  onOpenSettings: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({ onOpenSettings }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  
  useEffect(() => {
    const updateKey = () => {
      const storedKey = typeof localStorage !== 'undefined' ? localStorage.getItem('tinker_gemini_api_key') : null;
      setApiKey(
        storedKey ||
        (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '') ||
        ''
      );
    };
    updateKey();
    window.addEventListener('storage', updateKey);
    return () => window.removeEventListener('storage', updateKey);
  }, []);

  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'error';
    source?: string;
  } | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const command = input.trim();
    setLoading(true);
    setStatusMessage(null);

    try {
      const result = await processArchitectureInstruction(command);
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

  const handleSuggestion = (prompt: string) => {
    setInput(prompt);
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4 flex flex-col items-center gap-2 select-none">
      {/* Status banner */}
      {statusMessage && (
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
          onClick={() => handleSuggestion('Add a payments service')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "Add a payments service"
        </button>
        <button
          onClick={() => handleSuggestion('Connect payments to postgres')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "Connect payments to postgres"
        </button>
        <button
          onClick={() => handleSuggestion('Put Redis between orders and postgres')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "Put Redis between orders and postgres"
        </button>
        <button
          onClick={() => handleSuggestion('Remove auth')}
          className="px-2.5 py-1 rounded-full bg-[#11141c]/80 hover:bg-slate-800 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap"
        >
          "Remove auth"
        </button>
      </div>

      {/* Voice Control Orb */}
      <div className="relative mb-2">
        <VoiceControl apiKey={apiKey} onOpenSettings={onOpenSettings} />
      </div>

      {/* Main Floating Input Bar */}
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
          placeholder='Describe architecture change... (e.g. "Put Redis between Orders and Postgres")'
          disabled={loading}
          className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-50"
        />

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
