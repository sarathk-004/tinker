import React from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { useConversationStore } from '../ai/conversationStore';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { useUi } from '../shell/uiStore';

const STARTERS = ['Client talks to an API Gateway, then Orders and Auth', 'Add a PostgreSQL database and a Redis cache', 'What happens if Auth goes down?'];

/** Shown over an empty canvas: how to begin. The chat on the right does the work; the examples fill its box for editing. */
export const EmptyCanvas: React.FC = () => {
  const aiAvailable = useWorkspaceStore((s) => s.features.aiCommands);
  const startWith = (text: string) => {
    useConversationStore.getState().setDraft(text);
    useUi.getState().set({ chatOpen: true }); // on narrow screens the chat is a drawer: open it so the filled box is visible
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 px-6 select-none">
      <div className="w-full max-w-md text-center pointer-events-auto">
        <span className="inline-flex w-11 h-11 rounded-xl bg-surface border border-line items-center justify-center mb-4"><MessageSquare className="w-5 h-5 text-primary" /></span>
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Start your diagram</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-body">
          {aiAvailable ? 'Describe your system to Tinker in the chat, or pick a component from Add component in the toolbar.' : 'Pick a component from Add component in the toolbar to begin. Typed commands are not available on this server.'}
        </p>
        {aiAvailable && (
          <div className="mt-5 flex flex-col gap-2">
            {STARTERS.map((text) => (
              <button key={text} onClick={() => startWith(text)} className="px-4 py-2.5 rounded-xl bg-surface border border-line hover:border-line-strong text-left text-[13.5px] text-ink flex items-center gap-2.5">
                <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" /> {text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
