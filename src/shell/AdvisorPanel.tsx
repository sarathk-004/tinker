import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Eye, Lightbulb, Loader2, PlusCircle, Sparkles, X } from 'lucide-react';
import { applyFix, useAdvisor } from '../advisor/useAdvisor';
import { SEVERITY_LABEL, type Finding, type Severity } from '../advisor/rules';
import { submitAiAsk, showOnDiagram } from '../ai/aiCommands';
import { useDiagramStore } from '../diagram/store';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { MONO_LABEL } from './Popover';
import { openRightTab } from './uiStore';

const DOT: Record<Severity, string> = { critical: 'bg-danger', high: 'bg-[#e0662a]', medium: 'bg-warn', low: 'bg-[#8a8f98]' };
const TEXT: Record<Severity, string> = { critical: 'text-danger', high: 'text-[#c24f12]', medium: 'text-[#9a6a1f]', low: 'text-[#6b6f76]' };

/** What the AI is asked when the person wants a second opinion. It sees the real diagram (the server adds it), and the answer lands in the chat. */
export const AI_REVIEW_QUESTION = 'Review this architecture like a senior engineer. List the most important risks for security, reliability, scalability and cost. Name the specific components involved and give a concrete fix for each, most serious first.';

const FindingCard: React.FC<{ f: Finding; onDismiss: () => void }> = ({ f, onDismiss }) => {
  const [open, setOpen] = useState(f.severity === 'critical' || f.severity === 'high');
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-xl bg-surface border border-line p-3">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[f.severity]}`} />
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex-1 min-w-0 text-left">
          <div className="text-[13px] font-medium text-ink leading-snug">{f.title}</div>
          <div className={`mt-0.5 flex items-center gap-1.5 ${MONO_LABEL}`}>
            <span className={TEXT[f.severity]}>{SEVERITY_LABEL[f.severity]}</span>
            <span aria-hidden>·</span>
            <span>{f.category}</span>
          </div>
        </button>
        <button onClick={onDismiss} title="Dismiss. It comes back only if the problem changes" aria-label={`Dismiss: ${f.title}`} className="p-1 -mr-1 rounded-md text-faint hover:text-ink hover:bg-canvas">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-body">
          <p>{f.why}</p>
          <p><span className="font-medium text-ink">What to do: </span>{f.fix}</p>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={() => showOnDiagram(f.nodeIds)} className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-line bg-soft hover:border-ink text-[12px] font-medium text-ink">
          <Eye className="w-3.5 h-3.5" /> Show
        </button>
        {f.action && (
          <button
            onClick={async () => {
              setBusy(true);
              await applyFix(f.action!);
              setBusy(false);
            }}
            disabled={busy}
            title={f.action.label}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-line bg-soft hover:bg-primary hover:border-primary hover:text-white text-[12px] font-medium text-ink transition-colors disabled:opacity-60 min-w-0"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <PlusCircle className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="truncate">Apply fix</span>
          </button>
        )}
      </div>
    </div>
  );
};

/** The left column's review of the open diagram: computed from the real components and connections, with an optional AI second opinion. */
export const AdvisorPanel: React.FC = () => {
  const { findings, dismissed, readiness, componentCount, dismiss, restoreAll } = useAdvisor();
  const modelAvailable = useWorkspaceStore((s) => s.features.aiModel);
  const quota = useWorkspaceStore((s) => s.quota);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const pending = useDiagramStore((s) => s.doc.pending > 0);
  const [open, setOpen] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  const color = readiness >= 80 ? '#1f8a65' : readiness >= 50 ? '#c08532' : '#cf2d56';
  const out = !!quota && quota.ai.limit > 0 && quota.ai.used >= quota.ai.limit;
  const critical = findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;

  const askAi = async () => {
    openRightTab('chat');
    await submitAiAsk(AI_REVIEW_QUESTION);
    void useWorkspaceStore.getState().refreshQuota();
  };

  return (
    <div className="flex-shrink-0 border-t border-line px-3 pt-3 pb-3 max-h-[52%] overflow-y-auto">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center justify-between px-1 mb-2">
        <span className={`flex items-center gap-1.5 ${MONO_LABEL}`}>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Lightbulb className="w-3.5 h-3.5 text-primary" /> Review
        </span>
        {componentCount > 0 && (
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-md" style={{ color, background: `${color}1a` }}>
            {findings.length === 0 ? 'all clear' : critical > 0 ? `${critical} important` : `${findings.length} to look at`}
          </span>
        )}
      </button>

      {open &&
        (componentCount === 0 ? (
          <p className="px-1 text-[12.5px] leading-relaxed text-muted">Add components and connect them. The review reads the real connections and points out what a careful engineer would.</p>
        ) : (
          <div className="space-y-2">
            <div className="rounded-xl bg-soft border border-line p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12.5px] font-medium text-ink">Production readiness</span>
                <span className="font-mono text-[12px] font-semibold" style={{ color }}>{readiness}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-fill overflow-hidden"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${readiness}%`, background: color }} /></div>
              <p className="mt-2 text-[11.5px] leading-snug text-muted">Worked out from your components and connections. No AI needed.</p>
            </div>

            {findings.length === 0 ? (
              <div className="flex items-start gap-2 rounded-xl bg-success-tint border border-success/20 p-3">
                <CheckCircle2 className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                <p className="text-[12.5px] leading-snug text-ink">{componentCount < 3 ? 'Nothing to flag yet. The review gets more useful as the diagram grows.' : 'Nothing to flag in what the diagram shows. That is not a guarantee: ask for an AI review for a second opinion.'}</p>
              </div>
            ) : (
              findings.map((f) => <FindingCard key={f.id} f={f} onDismiss={() => dismiss(f.id)} />)
            )}

            {dismissed.length > 0 && (
              <div className="px-1">
                <button onClick={() => setShowDismissed((v) => !v)} className="text-[12px] text-muted hover:text-ink">
                  {dismissed.length} dismissed {showDismissed ? '· hide' : '· show'}
                </button>
                {showDismissed && (
                  <ul className="mt-1.5 space-y-1">
                    {dismissed.map((f) => (
                      <li key={f.id} className="text-[12px] text-muted truncate" title={f.title}>{f.title}</li>
                    ))}
                    <li><button onClick={restoreAll} className="text-[12px] font-medium text-primary hover:text-primary-hover">Bring them all back</button></li>
                  </ul>
                )}
              </div>
            )}

            {modelAvailable && hasDiagram && (
              <button
                onClick={() => void askAi()}
                disabled={out || pending}
                title={out ? 'No AI requests left today' : 'Asks the AI to review this diagram and answers in the chat. Uses 1 AI request.'}
                className="w-full h-9 rounded-lg border border-line bg-surface hover:border-ink disabled:opacity-50 text-[12.5px] font-medium text-ink flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" /> Ask AI for a deeper review
              </button>
            )}
          </div>
        ))}
    </div>
  );
};
