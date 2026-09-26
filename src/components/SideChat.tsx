import React, { useRef, useEffect, useState } from 'react';
import { useConversationStore } from '../ai/conversationStore';
import {
  Bot,
  User,
  Volume2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Sparkles,
  Check,
  CheckCircle2,
  Mic,
} from 'lucide-react';
import {
  speakWithGeminiVoice,
  getSelectedGeminiVoice,
  setSelectedGeminiVoice,
  AVAILABLE_GEMINI_VOICES,
  GeminiVoiceName,
  stopVoice,
} from '../ai/geminiVoice';
import { processArchitectureInstruction } from '../ai/orchestrator';

export const SideChat: React.FC = () => {
  const turns = useConversationStore((s) => s.turns);
  const clearTurns = useConversationStore((s) => s.clear);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [currentVoice, setCurrentVoice] = useState<GeminiVoiceName>(getSelectedGeminiVoice());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPlayingId, setIsPlayingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to latest message
  useEffect(() => {
    if (scrollRef.current && !isMinimized) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isMinimized]);

  const handleVoiceChange = (voice: GeminiVoiceName) => {
    setCurrentVoice(voice);
    setSelectedGeminiVoice(voice);
  };

  const handlePromptClick = (prompt: string) => {
    processArchitectureInstruction(prompt);
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const playVoiceMessage = async (id: string, text: string) => {
    setIsPlayingId(id);
    await speakWithGeminiVoice(text, currentVoice);
    setIsPlayingId(null);
  };

  // Minimized Floating Pill - MongoDB Green Pill Button
  if (isMinimized) {
    return (
      <div className="absolute top-20 left-6 z-30 pointer-events-auto select-none">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#001e2b]/95 hover:bg-[#002636] border border-[#1c2d38] hover:border-[#00ed64]/50 text-xs font-semibold text-white shadow-2xl backdrop-blur-xl transition-all"
        >
          <div className="w-2 h-2 rounded-full bg-[#00ed64] animate-pulse" />
          <Bot className="w-4 h-4 text-[#00ed64]" />
          <span>Architecture Chat</span>
          {turns.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#00ed64]/15 text-[#00ed64] font-mono font-bold">
              {turns.length}
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-[#a8b3bc]" />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-20 left-6 z-30 pointer-events-auto select-none transition-all duration-300">
      <div
        className={`flex flex-col ${
          isWide ? 'w-[480px]' : 'w-84'
        } max-h-[calc(100vh-170px)] bg-[#001e2b]/95 backdrop-blur-2xl border border-[#1c2d38] rounded-2xl shadow-2xl overflow-hidden transition-all duration-200`}
      >
        {/* Chat Header - MongoDB Deep Teal */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#1c2d38] bg-[#002636]/90">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <div className="w-2 h-2 rounded-full bg-[#00ed64]" />
            <Bot className="w-4 h-4 text-[#00ed64]" />
            <span>Architecture Chat</span>
            <span className="text-[10px] font-mono text-[#a8b3bc] bg-[#001e2b] px-2 py-0.5 rounded-full border border-[#1c2d38]">
              {turns.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Gemini Nuanced Voice Selector Dropdown */}
            <select
              value={currentVoice}
              onChange={(e) => handleVoiceChange(e.target.value as GeminiVoiceName)}
              title="Select Gemini Voice Model"
              className="text-[10px] font-semibold bg-[#001e2b] text-[#00ed64] border border-[#1c2d38] hover:border-[#00ed64]/40 rounded-full px-2 py-0.5 focus:outline-none cursor-pointer"
            >
              {AVAILABLE_GEMINI_VOICES.map((v) => (
                <option key={v.name} value={v.name} className="bg-[#001e2b] text-white">
                  🎙️ {v.label} ({v.gender})
                </option>
              ))}
            </select>

            {/* Dynamic Width Expander */}
            <button
              onClick={() => setIsWide(!isWide)}
              title={isWide ? 'Compact view' : 'Expand width for detailed responses'}
              className="p-1 rounded-full text-[#a8b3bc] hover:text-[#00ed64] hover:bg-[#001e2b] transition-colors"
            >
              {isWide ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            {/* Clear conversation */}
            {turns.length > 0 && (
              <button
                onClick={() => {
                  stopVoice();
                  clearTurns();
                }}
                title="Clear conversation"
                className="p-1 rounded-full text-[#a8b3bc] hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Minimize toggle */}
            <button
              onClick={() => setIsMinimized(true)}
              title="Minimize chat"
              className="p-1 rounded-full text-[#a8b3bc] hover:text-white hover:bg-[#001e2b] transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Message Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
          {turns.length === 0 ? (
            <div className="flex flex-col gap-3 py-2 text-xs">
              <div className="p-3.5 rounded-xl bg-[#002636]/60 border border-[#1c2d38] text-slate-300 text-center">
                <Sparkles className="w-5 h-5 text-[#00ed64] mx-auto mb-1.5" />
                <p className="font-semibold text-white">Talk to your Architecture</p>
                <p className="text-[11px] text-[#a8b3bc] mt-1 leading-relaxed">
                  Ask architectural questions, simulate failure scenarios, or instruct changes naturally.
                </p>
              </div>

              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-[#a8b3bc] uppercase tracking-wider">
                  Quick Prompts
                </span>
                <span className="text-[9px] font-semibold text-[#00ed64] bg-[#00ed64]/10 px-2 py-0.5 rounded-full border border-[#00ed64]/20">
                  Voice Enabled
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                {[
                  { text: 'What happens if Auth goes down?', tag: 'Failure Analysis', color: 'border-[#7b3ff2]/40 text-purple-300' },
                  { text: 'Simplify this for a non-technical person', tag: 'Explanation', color: 'border-[#00ed64]/40 text-[#00ed64]' },
                  { text: 'Highlight the payment flow', tag: 'Tracing', color: 'border-[#fa6e39]/40 text-orange-300' },
                  { text: 'Put Redis between orders and postgres', tag: 'Mutation', color: 'border-[#3d4f9f]/40 text-blue-300' },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={() => handlePromptClick(item.text)}
                    className="text-left p-2 rounded-xl bg-[#002636]/50 hover:bg-[#003d4f] border border-[#1c2d38] hover:border-[#00ed64]/40 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-full bg-[#001e2b] border border-[#1c2d38] text-[#a8b3bc]">
                        {item.tag}
                      </span>
                      <Mic className="w-2.5 h-2.5 text-[#5c6c7a] group-hover:text-[#00ed64] transition-colors" />
                    </div>
                    <p className="text-[11px] text-slate-200 group-hover:text-white font-medium">
                      "{item.text}"
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => {
              const isUser = turn.role === 'user';
              const isDiagramEditOnly =
                !isUser &&
                turn.text === 'Diagram updated.' &&
                turn.actions &&
                turn.actions.length > 0;

              return (
                <div
                  key={turn.id}
                  className={`flex flex-col gap-1 rounded-xl p-3 text-xs transition-all ${
                    isUser
                      ? 'bg-[#002636]/90 border border-[#003d4f] text-slate-100'
                      : 'bg-[#01202e] border border-[#1c2d38] text-slate-200 shadow-sm'
                  }`}
                >
                  {/* Sender Tag */}
                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5 font-bold">
                      {isUser ? (
                        <>
                          <User className="w-3 h-3 text-[#a8b3bc]" />
                          <span className="text-[#a8b3bc]">You</span>
                        </>
                      ) : (
                        <>
                          <div className="w-1.5 h-1.5 rounded-full bg-[#00ed64]" />
                          <span className="text-[#00ed64]">Tinker AI</span>
                        </>
                      )}
                    </div>

                    {!isUser && !isDiagramEditOnly && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-[#5c6c7a]">
                          {turn.source === 'gemini' ? 'Gemini 3.8 Flash' : 'Local'}
                        </span>
                        <button
                          onClick={() => playVoiceMessage(turn.id, turn.text)}
                          title={`Listen with Gemini Voice (${currentVoice})`}
                          className={`p-1 rounded-full transition-colors ${
                            isPlayingId === turn.id
                              ? 'text-[#00ed64] bg-[#00ed64]/15 animate-pulse'
                              : 'text-[#a8b3bc] hover:text-[#00ed64] hover:bg-[#002636]'
                          }`}
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Body Content - No noisy Added (___) chips! */}
                  {isDiagramEditOnly ? (
                    <div className="flex items-center gap-2 mt-1 py-0.5">
                      <CheckCircle2 className="w-4 h-4 text-[#00ed64]" />
                      <span className="text-xs font-semibold text-[#00ed64]">
                        Architecture Synced
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 leading-relaxed whitespace-pre-wrap select-text text-slate-200 font-sans">
                      {turn.text}
                    </div>
                  )}

                  {/* Copy Button */}
                  {!isUser && !isDiagramEditOnly && (
                    <div className="flex justify-end mt-1">
                      <button
                        onClick={() => copyText(turn.id, turn.text)}
                        className="text-[10px] text-[#5c6c7a] hover:text-white flex items-center gap-1 transition-colors"
                      >
                        {copiedId === turn.id ? (
                          <>
                            <Check className="w-2.5 h-2.5 text-[#00ed64]" />
                            <span className="text-[#00ed64]">Copied</span>
                          </>
                        ) : (
                          <span>Copy</span>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
