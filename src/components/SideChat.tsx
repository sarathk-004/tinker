import React, { useRef, useEffect, useState } from 'react';
import { useConversationStore } from '../ai/conversationStore';
import {
  Bot,
  User,
  Volume2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Check,
} from 'lucide-react';
import { speakText } from '../ai/speechSynthesis';
import { processArchitectureInstruction } from '../ai/orchestrator';

export const SideChat: React.FC = () => {
  const turns = useConversationStore((s) => s.turns);
  const clearTurns = useConversationStore((s) => s.clear);
  const [isMinimized, setIsMinimized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Auto-scroll chat to latest message
  useEffect(() => {
    if (scrollRef.current && !isMinimized) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isMinimized]);

  const handlePromptClick = (prompt: string) => {
    processArchitectureInstruction(prompt);
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // Minimized Floating Pill
  if (isMinimized) {
    return (
      <div className="absolute top-20 left-6 z-30 pointer-events-auto select-none">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#11141c]/90 hover:bg-[#161a24] border border-slate-800 text-xs font-semibold text-slate-200 shadow-2xl backdrop-blur-xl transition-all"
        >
          <Bot className="w-4 h-4 text-amber-400" />
          <span>Architecture Chat</span>
          {turns.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-mono">
              {turns.length}
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-20 left-6 z-30 pointer-events-auto select-none">
      <div className="flex flex-col w-84 max-h-[calc(100vh-170px)] bg-[#11141c]/92 backdrop-blur-2xl border border-slate-800/90 rounded-2xl shadow-2xl overflow-hidden transition-all">
        {/* Chat Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800/80 bg-[#0d1017]/80">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Bot className="w-4 h-4 text-amber-400" />
            <span>Architecture Chat</span>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded-full border border-slate-800">
              {turns.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {turns.length > 0 && (
              <button
                onClick={() => clearTurns()}
                title="Clear conversation"
                className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setIsMinimized(true)}
              title="Minimize chat"
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Message Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {turns.length === 0 ? (
            <div className="flex flex-col gap-3 py-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 text-slate-400 text-center">
                <Sparkles className="w-5 h-5 text-amber-400 mx-auto mb-1.5" />
                <p className="font-medium text-slate-300">Talk to your Architecture</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Ask questions, simulate failures, or modify AWS components using voice or text.
                </p>
              </div>

              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1">
                Suggested Prompts
              </span>

              <div className="flex flex-col gap-1.5">
                {[
                  'What happens if Auth goes down?',
                  'Simplify this for a non-technical person',
                  'Highlight the payment flow',
                  'Add Redis between orders and postgres',
                  'Client talks to Load Balancer',
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handlePromptClick(prompt)}
                    className="text-left px-2.5 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/80 border border-slate-800/60 hover:border-amber-500/30 text-slate-300 hover:text-amber-300 text-[11px] font-medium transition-all"
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => {
              const isUser = turn.role === 'user';
              const isActionOnly =
                !isUser &&
                turn.actions &&
                turn.actions.length > 0 &&
                turn.actions.every((a) =>
                  /^(?:Added|Removed|Connected|Disconnected|Inserted|Renamed|Highlighted)/i.test(a)
                );

              return (
                <div
                  key={turn.id}
                  className={`flex flex-col gap-1 rounded-xl p-2.5 text-xs transition-all ${
                    isUser
                      ? 'bg-sky-950/30 border border-sky-800/40 text-sky-200'
                      : 'bg-slate-900/70 border border-slate-800/80 text-slate-200'
                  }`}
                >
                  {/* Sender Tag */}
                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {isUser ? (
                        <>
                          <User className="w-3 h-3 text-sky-400" />
                          <span className="text-sky-400">You</span>
                        </>
                      ) : (
                        <>
                          <Bot className="w-3 h-3 text-amber-400" />
                          <span className="text-amber-400">Tinker AI</span>
                        </>
                      )}
                    </div>

                    {!isUser && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-slate-500">
                          {turn.source === 'gemini' ? 'Gemini 3.8 Flash' : 'Local Engine'}
                        </span>
                        <button
                          onClick={() => speakText(turn.text)}
                          title="Replay voice audio"
                          className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors"
                        >
                          <Volume2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Body Content */}
                  {isActionOnly ? (
                    <div className="flex flex-col gap-1.5 mt-0.5">
                      <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                        <Sparkles className="w-3 h-3" />
                        <span>Diagram Updated</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {turn.actions?.map((act, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] font-mono bg-slate-950 px-2 py-0.5 rounded-md text-slate-400 border border-slate-800"
                          >
                            {act}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 leading-relaxed whitespace-pre-wrap select-text text-slate-300">
                      {turn.text}
                    </div>
                  )}

                  {/* Action Copy for Assistant */}
                  {!isUser && !isActionOnly && (
                    <div className="flex justify-end mt-1">
                      <button
                        onClick={() => copyText(turn.id, turn.text)}
                        className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
                      >
                        {copiedId === turn.id ? (
                          <>
                            <Check className="w-2.5 h-2.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
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
