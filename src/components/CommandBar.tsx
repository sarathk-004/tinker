import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Command, Loader2, Mic, Sparkles } from 'lucide-react';
import { submitAiCommand } from '../ai/aiCommands';
import { useConversationStore } from '../ai/conversationStore';
import { useDiagramStore } from '../diagram/store';
import { useWorkspaceStore } from '../workspace/workspaceStore';

const EXAMPLES = ['Put Redis between Orders and PostgreSQL', 'Add an API Gateway', 'Connect Orders to Billing'];

/**
 * Typed commands. Text goes to the server, which applies it as one atomic edit (or asks a question); nothing here edits
 * the diagram directly. Voice returns later (I7). Disabled with an explanation when the server has no AI configured.
 */
export const CommandBar: React.FC = () => {
  const aiAvailable = useWorkspaceStore((s) => s.features.aiCommands);
  const modelAvailable = useWorkspaceStore((s) => s.features.aiModel);
  const pending = useConversationStore((s) => s.pending);
  const draft = useConversationStore((s) => s.draft);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const blocked = useDiagramStore((s) => s.doc.status === 'conflict' || s.doc.status === 'blocked');
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Suggestion chips in the conversation fill the bar; the user decides whether to send.
  useEffect(() => {
    if (draft) {
      setInput(draft);
      useConversationStore.getState().setDraft('');
      inputRef.current?.focus();
    }
  }, [draft]);

  const disabled = !aiAvailable || !hasDiagram || blocked;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || pending || !input.trim()) return;
    const text = input;
    const ok = await submitAiCommand(text);
    if (ok) setInput((current) => (current === text ? '' : current)); // keep what the user typed meanwhile
  };

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4 select-none flex flex-col gap-2">
      {aiAvailable && !pending && input === '' && hasDiagram && (
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#5a5852] overflow-x-auto">
          <span className="flex items-center gap-1 font-mono text-[#807d72] flex-shrink-0">
            <Sparkles className="w-3 h-3 text-[#f54e00]" /> Try:
          </span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setInput(ex)} className="px-2 py-1 rounded-md bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] whitespace-nowrap">
              {ex}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={submit}
        aria-disabled={disabled}
        className={`w-full flex items-center gap-2 p-1.5 pl-3.5 rounded-md bg-white border border-[#e6e5e0] transition-all focus-within:border-[#26251e] ${disabled ? 'opacity-80' : 'hover:border-[#cfcdc4]'}`}
      >
        <Command className="w-4 h-4 text-[#807d72]" />
        <input
          ref={inputRef}
          type="text"
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || pending}
          placeholder={
            !aiAvailable
              ? 'Typed commands are not available right now. Manual editing works as usual.'
              : modelAvailable
              ? 'Type a command, e.g. "Put Redis between Orders and PostgreSQL"…'
              : 'Type a simple command, e.g. "Put Redis between Orders and PostgreSQL" (free-form AI needs a key on the server)…'
          }
          aria-label="Command"
          className="flex-1 bg-transparent text-sm text-[#26251e] placeholder-[#807d72] focus:outline-none disabled:cursor-not-allowed font-sans"
        />
        <button type="button" disabled title="Voice returns in a later update" className="p-1.5 rounded-md bg-[#fafaf7] border border-[#e6e5e0] text-[#a09c92] cursor-not-allowed">
          <Mic className="w-4 h-4" />
        </button>
        <button
          type="submit"
          disabled={disabled || pending || !input.trim()}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-[#f54e00] hover:bg-[#d04200] disabled:bg-[#e6e5e0] disabled:text-[#a09c92] disabled:cursor-not-allowed text-white transition-all"
          aria-label="Send command"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
};
