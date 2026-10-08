import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowUpRight, Check, HelpCircle, History, Loader2, MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import { showOnDiagram, submitAiCommand } from '../ai/aiCommands';
import { useConversationStore, type ConversationTurn } from '../ai/conversationStore';
import { isReplyOption } from '../ai/replies';
import { useDiagramStore } from '../diagram/store';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { useSpeechSettings, effectiveVoice, stopSpeaking, type ReplyVoice } from '../voice/speech';
import { TinkerLogo } from '../components/TinkerLogo';
import { Composer } from './Composer';
import { MENU_ITEM, MENU_PANEL, MONO_LABEL, useDismiss } from './Popover';
import { useUi } from './uiStore';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(today.getTime() - 86_400_000);
  return same(d, today) ? 'Today' : same(d, yesterday) ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Clicking a reply button sends it straight away; any other suggestion goes into the box so the person can change it first. */
const pick = (option: string) => {
  if (isReplyOption(option)) void submitAiCommand(option);
  else useConversationStore.getState().setDraft(option);
};

const ShowOnDiagram: React.FC<{ ids: string[] }> = ({ ids }) => (
  <div className="mt-2.5 flex gap-2">
    <button onClick={() => showOnDiagram(ids)} className="h-8 px-3 rounded-lg border border-line bg-surface hover:border-ink text-[12.5px] font-medium">Show on diagram</button>
    <button onClick={() => useDiagramStore.getState().clearHighlight()} className="h-8 px-3 rounded-lg border border-line bg-surface hover:border-ink text-[12.5px] text-body">Clear</button>
  </div>
);

const AssistantHeader: React.FC<{ turn: ConversationTurn }> = ({ turn }) => (
  <div className="flex items-center gap-2 mb-1.5">
    <TinkerLogo size={18} />
    <span className="text-[13.5px] font-semibold text-ink">Tinker</span>
    <span className="font-mono text-[10.5px] text-faint">{clock(turn.timestamp)}</span>
    {turn.source === 'AI' && <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-md bg-fill text-body">AI</span>}
  </div>
);

/** One message in the conversation. */
const TurnView: React.FC<{ turn: ConversationTurn }> = ({ turn }) => {
  if (turn.role === 'user') {
    return (
      <div className={`rounded-xl bg-bubble px-4 py-3 ${turn.kind === 'sending' ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[13px] font-semibold text-ink">You</span>
          <span className="font-mono text-[10.5px] text-faint">{clock(turn.timestamp)}</span>
        </div>
        <p className="text-[14.5px] leading-[1.55] text-ink whitespace-pre-wrap break-words">{turn.text}</p>
      </div>
    );
  }

  if (turn.kind === 'error' || turn.kind === 'refused') {
    return (
      <div>
        <AssistantHeader turn={turn} />
        <div className="rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-[14px] leading-[1.55] text-danger-ink whitespace-pre-wrap break-words">{turn.text}</div>
      </div>
    );
  }

  if (turn.kind === 'clarification') {
    return (
      <div>
        <AssistantHeader turn={turn} />
        <div className="rounded-xl bg-question border border-question-line px-4 py-3.5">
          <div className="flex items-center gap-2 mb-1.5 text-warn-ink">
            <HelpCircle className="w-4 h-4" />
            <span className="text-[13px] font-semibold">One question</span>
          </div>
          <p className="text-[14.5px] leading-[1.55] text-ink whitespace-pre-wrap break-words">{turn.text}</p>
          {turn.options && turn.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {turn.options.map((option) => {
                const yes = isReplyOption(option) && option.startsWith('Yes');
                return (
                  <button
                    key={option}
                    onClick={() => pick(option)}
                    title={isReplyOption(option) ? 'Send this answer' : 'Put this in the message box'}
                    className={`h-8 px-3.5 rounded-lg text-[13px] font-medium transition-colors ${yes ? 'bg-primary hover:bg-primary-hover text-white' : 'bg-surface border border-line hover:border-ink text-ink'}`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (turn.kind === 'applied') {
    const n = turn.actions?.length ?? 0;
    return (
      <div>
        <AssistantHeader turn={turn} />
        <p className="text-[14.5px] leading-[1.55] text-ink whitespace-pre-wrap break-words">{turn.text}</p>
        {n > 1 && (
          <ul className="mt-2.5 space-y-1.5">
            {turn.actions!.map((a, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-snug text-ink">
                <Check className="w-4 h-4 mt-px text-success flex-shrink-0" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-info-line bg-info px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Sparkles className="w-4 h-4 text-primary" /> {n > 1 ? `${n} changes applied` : 'Change applied'}</div>
            <button onClick={() => useUi.getState().set({ versionsOpen: true, navOpen: true })} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:text-primary-hover">
              View changes <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {turn.version !== undefined && (
            <span className="font-mono text-[11px] text-body whitespace-nowrap">v{Math.max(1, turn.version - 1)} → v{turn.version}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <AssistantHeader turn={turn} />
      <p className="text-[14.5px] leading-[1.55] text-ink whitespace-pre-wrap break-words">{turn.text}</p>
      {turn.kind === 'advice' && turn.highlight && turn.highlight.length > 0 && <ShowOnDiagram ids={turn.highlight} />}
    </div>
  );
};

const examples = ['Put Redis between Orders and PostgreSQL', 'Add an API Gateway', 'What happens if Orders goes down?'];

const EmptyState: React.FC<{ canType: boolean }> = ({ canType }) => (
  <div className="h-full flex flex-col items-center justify-center text-center px-6">
    <span className="w-11 h-11 rounded-xl bg-soft border border-line flex items-center justify-center mb-3"><TinkerLogo size={24} /></span>
    <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Tinker it</h2>
    <p className="mt-1.5 text-[13.5px] leading-relaxed text-body max-w-[17rem]">Describe a change in plain words, or ask a question about the diagram. Every change is saved as a version you can go back to.</p>
    {canType && (
      <div className="mt-4 flex flex-col gap-2 w-full max-w-[19rem]">
        {examples.map((ex) => (
          <button key={ex} onClick={() => useConversationStore.getState().setDraft(ex)} className="px-3.5 py-2.5 rounded-xl border border-line bg-soft hover:border-line-strong text-left text-[13px] text-ink">
            {ex}
          </button>
        ))}
      </div>
    )}
  </div>
);

const MoreMenu: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const voiceAvailable = useWorkspaceStore((s) => s.features.voice);
  const saved = useSpeechSettings((s) => s.saved);
  const serverCanSpeak = useSpeechSettings((s) => s.serverCanSpeak);
  const current = effectiveVoice(saved, serverCanSpeak);
  const options: Array<[ReplyVoice, string, string, boolean]> = [
    ['gemini', 'Gemini voice', 'Natural voice. Uses your daily allowance.', serverCanSpeak],
    ['browser', 'Browser voice', 'Free, built into your browser.', true],
    ['off', 'Off', 'Replies stay text only.', true],
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="More" aria-haspopup="menu" aria-expanded={open} className="p-2 rounded-lg text-body hover:bg-canvas hover:text-ink">
        <MoreHorizontal className="w-[18px] h-[18px]" />
      </button>
      {open && (
        <div role="menu" className={`${MENU_PANEL} right-0 top-full mt-1 w-72`}>
          <div className={`px-2.5 pt-1.5 pb-1 ${MONO_LABEL}`}>Read replies aloud{voiceAvailable ? '' : ' (browser only)'}</div>
          {options.map(([value, label, hint, enabled]) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={current === value}
              disabled={!enabled}
              onClick={() => {
                useSpeechSettings.getState().choose(value);
                if (value === 'off') stopSpeaking();
                setOpen(false);
              }}
              className={MENU_ITEM}
            >
              <span className="w-4">{current === value && <Check className="w-4 h-4 text-primary" />}</span>
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-[12px] text-muted">{enabled ? hint : 'Not available on this server.'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** "History": opens the popup with the person's earlier chats about this diagram. */
const HistoryMenu: React.FC = () => {
  const diagramId = useDiagramStore((s) => s.doc.diagram?.id ?? null);
  return (
    <button onClick={() => useUi.getState().set({ historyOpen: true })} disabled={!diagramId} aria-haspopup="dialog" className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-medium text-body hover:bg-canvas hover:text-ink disabled:opacity-40">
      <History className="w-4 h-4" /> History
    </button>
  );
};

/** The Tinker tab: history and new chat, the conversation, and the box to type or speak into. */
export const ChatBody: React.FC = () => {
  const turns = useConversationStore((s) => s.turns);
  const pending = useConversationStore((s) => s.pending);
  const aiAvailable = useWorkspaceStore((s) => s.features.aiCommands);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const groups = useMemo(() => {
    const out: Array<{ label: string; turns: ConversationTurn[] }> = [];
    for (const t of turns) {
      const label = dayLabel(t.timestamp);
      const last = out[out.length - 1];
      if (last?.label === label) last.turns.push(t);
      else out.push({ label, turns: [t] });
    }
    return out;
  }, [turns]);

  return (
    <>
      <div className="h-11 flex-shrink-0 flex items-center justify-between px-3 border-b border-fill">
        <HistoryMenu />
        <div className="flex items-center">
          <button
            onClick={() => useConversationStore.getState().startNew()}
            disabled={turns.length === 0}
            title="New chat (this one stays in History)"
            aria-label="New chat"
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-medium text-body hover:bg-canvas hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
          <MoreMenu />
        </div>
      </div>

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-5 py-4" aria-live="polite">
        {turns.length === 0 ? (
          <EmptyState canType={aiAvailable && hasDiagram} />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.label} className="space-y-5">
                <div className={`text-center ${MONO_LABEL}`}>{g.label}, {clock(g.turns[0]!.timestamp)}</div>
                {g.turns.map((t) => (
                  <TurnView key={t.id} turn={t} />
                ))}
              </div>
            ))}
            {pending && (
              <div className="flex items-center gap-2 text-[13px] text-body">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working on it…
              </div>
            )}
          </div>
        )}
      </div>

      <Composer />
    </>
  );
};
