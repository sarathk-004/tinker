import React, { useEffect, useRef, useState } from 'react';
import { useConversationStore } from '../ai/conversationStore';
import { MessageSquare, ChevronDown, ChevronUp, Trash2, Zap, User } from 'lucide-react';

export const ConversationLog: React.FC = () => {
  const turns = useConversationStore((s) => s.turns);
  const clear = useConversationStore((s) => s.clear);
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new turns
  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isExpanded]);

  if (turns.length === 0) return null;

  return (
    <div className="absolute top-20 right-6 z-30 pointer-events-auto select-none">
      <div className="bg-[#11141c]/90 backdrop-blur-xl border border-slate-800 rounded-xl shadow-2xl w-72 overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
            <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
            <span>Conversation</span>
            <span className="text-[10px] font-mono text-slate-400 normal-case bg-slate-900 px-1.5 py-0.5 rounded-full">
              {turns.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {isExpanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                }}
                title="Clear conversation"
                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            )}
          </div>
        </button>

        {/* Log entries */}
        {isExpanded && (
          <div
            ref={scrollRef}
            className="max-h-64 overflow-y-auto border-t border-slate-800"
          >
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={`px-3 py-2 text-xs border-b border-slate-800/60 ${
                  turn.role === 'user'
                    ? 'bg-slate-900/30'
                    : 'bg-[#0d1018]/60'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {turn.role === 'user' ? (
                    <User className="w-3 h-3 text-sky-400" />
                  ) : (
                    <Zap className="w-3 h-3 text-amber-400" />
                  )}
                  <span
                    className={`font-semibold text-[10px] uppercase tracking-wider ${
                      turn.role === 'user' ? 'text-sky-400' : 'text-amber-400'
                    }`}
                  >
                    {turn.role === 'user' ? 'You' : 'tinker'}
                  </span>
                  {turn.source && (
                    <span className="text-[9px] font-mono text-slate-500 ml-auto">
                      {turn.source === 'gemini' ? 'Gemini' : 'Local'}
                    </span>
                  )}
                </div>
                <p className="text-slate-300 leading-relaxed break-words">
                  {turn.role === 'user' ? (
                    <span className="italic text-slate-400">"{turn.text}"</span>
                  ) : (
                    turn.text
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
