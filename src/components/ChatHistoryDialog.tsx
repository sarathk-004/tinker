import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import { useConversationStore } from '../ai/conversationStore';
import type { ConversationSummary } from '../contracts';
import { useDiagramStore } from '../diagram/store';
import { api } from '../document/instance';
import { useUi } from '../shell/uiStore';
import { timeAgo } from './VersionsPanel';

const dayOf = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  if (days < 31) return 'Earlier this month';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

/** Earlier chats about this diagram, in a popup: searchable and grouped by day, so a long history stays easy to scan. Opening one continues it. */
export const ChatHistoryDialog: React.FC = () => {
  const open = useUi((s) => s.historyOpen);
  const diagramId = useDiagramStore((s) => s.doc.diagram?.id ?? null);
  const current = useConversationStore((s) => s.conversationId);
  const [chats, setChats] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const close = useCallback(() => useUi.getState().set({ historyOpen: false }), []);

  useEffect(() => {
    if (!open || !diagramId) return undefined;
    let live = true;
    setChats(null);
    setError(null);
    setQuery('');
    api.conversations(diagramId).then(
      (r) => live && setChats(r.conversations),
      () => live && setError('Could not load your earlier chats.'),
    );
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, diagramId, close]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = (chats ?? []).filter((c) => !q || c.title.toLowerCase().includes(q));
    const out: Array<{ label: string; chats: ConversationSummary[] }> = [];
    for (const c of shown) {
      const label = dayOf(c.updatedAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.chats.push(c);
      else out.push({ label, chats: [c] });
    }
    return out;
  }, [chats, query]);

  if (!open) return null;

  const openChat = async (id: string) => {
    if (!diagramId) return;
    close();
    try {
      const chat = await api.openConversation(diagramId, id);
      useConversationStore.getState().load(diagramId, { conversationId: chat.conversationId, messages: chat.messages });
    } catch {
      useConversationStore.getState().append([{ id: `local-${crypto.randomUUID()}`, timestamp: Date.now(), role: 'assistant', kind: 'error', text: 'That chat could not be opened.' }]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full max-w-lg h-[min(560px,90vh)] rounded-xl bg-surface border border-line shadow-lg text-ink flex flex-col overflow-hidden select-text">
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0">
          <h2 id="history-title" className="text-[16px] font-semibold flex-1">
            Chat history
          </h2>
          <button onClick={close} aria-label="Close history" className="p-1 rounded text-muted hover:text-ink hover:bg-canvas">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pb-3 flex-shrink-0">
          <label className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-canvas focus-within:border-primary">
            <Search className="w-4 h-4 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your chats" aria-label="Search your chats" className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 border-t border-line">
          {error && <p className="px-2 py-4 text-[13px] text-danger">{error}</p>}
          {!error && chats === null && (
            <p className="px-2 py-6 text-[13px] text-muted flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </p>
          )}
          {chats?.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-muted">No earlier chats yet. They appear here as you talk to Tinker.</p>}
          {chats && chats.length > 0 && groups.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-muted">No chat matches “{query}”.</p>}
          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="px-2 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{g.label}</h3>
              {g.chats.map((c) => (
                <button key={c.id} onClick={() => void openChat(c.id)} className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-canvas ${c.id === current ? 'bg-primary-tint' : ''}`}>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{c.title}</span>
                    <span className="block text-[11.5px] text-muted">
                      {timeAgo(c.updatedAt)} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  {c.id === current && <Check className="w-4 h-4 text-primary mt-0.5" />}
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
