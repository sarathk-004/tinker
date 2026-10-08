import React, { useEffect, useState } from 'react';
import { AlertTriangle, CloudOff, X } from 'lucide-react';
import { useDiagramStore } from '../diagram/store';
import { session } from '../document/instance';
import { useWorkspaceStore } from '../workspace/workspaceStore';

const bar = 'w-full px-6 py-2 flex flex-wrap items-center gap-3 text-xs border-b';
const btn = 'px-2.5 py-1 rounded-md border text-xs font-medium transition-colors';

/** Conflict / offline / unavailable banners, plus a short-lived toast for refusals. All driven by the document session. */
export const StatusBanners: React.FC = () => {
  const { status, conflict, notice } = useDiagramStore((s) => s.doc);
  const { refreshList, openDiagram, diagrams } = useWorkspaceStore.getState();
  const [reapplyMessage, setReapplyMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Refusals ("that node does not exist") are shown briefly; held states (failed / conflict) stay until resolved.
  useEffect(() => {
    if (!notice || status === 'conflict' || status === 'failed' || status === 'blocked') return;
    const timer = setTimeout(() => session.clearNotice(), 6000);
    return () => clearTimeout(timer);
  }, [notice, status]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await refreshList().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {status === 'conflict' && conflict && (
        <div role="alert" className={`${bar} bg-danger/10 border-danger/30 text-danger-ink`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-danger" />
          <span className="flex-1 min-w-[240px]">
            <strong>This diagram was changed in another tab or device.</strong> Nothing of yours was overwritten.{' '}
            {conflict.draftCount > 0
              ? `Your ${conflict.draftCount} unsaved change${conflict.draftCount === 1 ? '' : 's'} (${conflict.descriptions.slice(0, 3).join('; ')}${conflict.descriptions.length > 3 ? '…' : ''}) ${conflict.draftCount === 1 ? 'was' : 'were'} kept.`
              : ''}
            {reapplyMessage ? ` ${reapplyMessage}` : ''}
          </span>
          <button
            disabled={busy}
            onClick={() => run(async () => void (await session.reloadLatest()))}
            className={`${btn} bg-surface border-danger/40 hover:bg-danger/10`}
          >
            Load latest (discard mine)
          </button>
          {conflict.draftCount > 0 && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await session.reapplyDraft();
                  setReapplyMessage(r.refused > 0 ? `${r.applied} re-applied, ${r.refused} no longer possible.` : `${r.applied} re-applied.`);
                  setTimeout(() => setReapplyMessage(null), 6000);
                })
              }
              className={`${btn} bg-inverse border-inverse text-on-inverse hover:opacity-90`}
            >
              Re-apply my changes on latest
            </button>
          )}
        </div>
      )}

      {status === 'failed' && (
        <div role="alert" className={`${bar} bg-warn/15 border-warn/40 text-[#6b4a10]`}>
          <CloudOff className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{notice?.text ?? 'Your changes could not be saved yet.'} They are kept and will not be applied twice.</span>
          <button onClick={() => session.retry()} className={`${btn} bg-surface border-warn/50 hover:bg-warn/10`}>
            Retry now
          </button>
        </div>
      )}

      {status === 'blocked' && (
        <div role="alert" className={`${bar} bg-danger/10 border-danger/30 text-danger-ink`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-danger" />
          <span className="flex-1">{notice?.text ?? 'This diagram is no longer available.'}</span>
          {diagrams.find((d) => d.id !== session.getState().diagram?.id) && (
            <button onClick={() => void openDiagram(diagrams.find((d) => d.id !== session.getState().diagram?.id)!.id)} className={`${btn} bg-surface border-danger/40`}>
              Open another diagram
            </button>
          )}
        </div>
      )}

      {notice && status !== 'conflict' && status !== 'failed' && status !== 'blocked' && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-md bg-inverse text-on-inverse text-xs shadow-md max-w-md"
        >
          <span>{notice.text}</span>
          <button onClick={() => session.clearNotice()} aria-label="Dismiss" className="p-0.5 rounded hover:bg-surface/10">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
