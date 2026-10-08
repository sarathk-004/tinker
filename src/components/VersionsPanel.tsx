import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import type { RevisionSummary } from '../contracts';
import { useHistoryStore } from '../history/history';
import { useWorkspaceStore } from '../workspace/workspaceStore';

export const REASON_LABEL: Record<RevisionSummary['reason'], string> = {
  CHECKPOINT: 'Started empty',
  MANUAL_COMMAND: 'Edit',
  AI_COMMAND: 'Command',
  AUTOSAVE: 'Auto-save',
  RESTORE: 'Restored',
};

/** "just now", "5 min ago", "3 h ago", or the date. Pure so it can be tested. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Saved versions of this diagram, newest first, with one click to go back to any of them. Going back is itself saved as a new version. */
export const VersionsPanel: React.FC = () => {
  const { revisions, loading, busy, error, hasMore, retention, currentSource } = useHistoryStore();
  const me = useWorkspaceStore((s) => s.user?.id);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface">
      <div className="px-3 py-1.5 border-b border-line bg-soft flex-shrink-0 text-[10px] font-mono text-muted">
        Restoring never deletes anything: it is saved as a new version, so you can go forward again. Moving things around never creates a version. Keeps your latest {retention.keepLatest}, then one per hour for {retention.hourlyDays} days and one per day up to {retention.keepDays} days.
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {error && <div className="p-2 rounded-md border border-danger/30 bg-danger/5 text-[11px] text-danger-ink">{error}</div>}
        {revisions.length === 0 && !loading && <div className="p-3 text-xs text-muted">No saved versions yet. Make a change and it will appear here.</div>}
        {revisions.map((r) => {
          const current = r.version === currentSource;
          return (
            <div key={r.version} className={`p-2 rounded-md border text-xs ${current ? 'border-primary/50 bg-primary/5' : 'border-line bg-surface'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {REASON_LABEL[r.reason]} <span className="font-mono text-[10px] text-muted">v{r.version}</span>
                </span>
                {current ? (
                  <span className="text-[10px] font-mono text-primary">Showing now</span>
                ) : (
                  <button
                    onClick={() => void useHistoryStore.getState().restore(r.version)}
                    disabled={busy}
                    title="Make the diagram look like this version (saved as a new version)"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-soft hover:bg-surface border border-line hover:border-ink text-[11px] text-ink disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Restore
                  </button>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-body">
                {plural(r.nodeCount, 'component')} · {plural(r.edgeCount, 'connection')}
              </div>
              <div className="text-[10px] text-muted">
                {timeAgo(r.createdAt)} · {r.createdBy.id === me ? 'You' : (r.createdBy.name ?? 'A collaborator')}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-body">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        )}
        {hasMore && !loading && (
          <button onClick={() => void useHistoryStore.getState().loadMore()} className="w-full py-1.5 text-[11px] text-body hover:text-ink border border-dashed border-line rounded-md">
            Show older versions
          </button>
        )}
      </div>
    </div>
  );
};
