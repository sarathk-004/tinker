import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { DiagramCard } from '../contracts';
import { DiagramThumb } from '../components/DiagramThumb';
import { timeAgo } from '../components/VersionsPanel';
import { useWorkspaceStore } from '../workspace/workspaceStore';

/** The landing pages sit on a cutting-mat grid. */
export const PageFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex-1 min-h-0 overflow-y-auto cutting-mat">
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-8">{children}</div>
  </div>
);

export interface Crumb {
  label: string;
  go?: () => void;
}

/** "All workspaces > Payments > Checkout": every part but the last is a way back. */
export const Crumbs: React.FC<{ items: Crumb[] }> = ({ items }) => (
  <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-[13px] text-muted mb-3">
    {items.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
        {c.go ? (
          <button onClick={c.go} className="px-1.5 py-0.5 -mx-1.5 rounded-md hover:bg-surface hover:text-ink truncate max-w-[220px]">
            {c.label}
          </button>
        ) : (
          <span className="text-ink font-medium truncate max-w-[260px]">{c.label}</span>
        )}
      </React.Fragment>
    ))}
  </nav>
);

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{children}</h2>
    {right}
  </div>
);

/** Open the diagram a card shows, whichever workspace and project it is in. */
export async function openCard(card: DiagramCard): Promise<void> {
  const s = useWorkspaceStore.getState();
  if (s.workspace?.id !== card.workspaceId) await s.switchWorkspace(card.workspaceId, { open: false });
  await s.loadProjects();
  await s.openDiagramInEditor(card.id);
}

/** A diagram as a card: a drawing of its layout, its name, how big it is, where it lives and when it changed. */
export const DiagramCardView: React.FC<{ card: DiagramCard; showPath?: boolean; extra?: React.ReactNode }> = ({ card, showPath = false, extra }) => (
  <div className="group relative rounded-2xl border border-line bg-surface hover:border-line-strong hover:shadow-[0_4px_18px_rgba(38,37,30,0.07)] transition-all">
    <button onClick={() => void openCard(card)} className="w-full text-left rounded-2xl" aria-label={`Open ${card.name}`}>
      <div className="h-32 m-2 mb-0 rounded-xl border border-line bg-canvas overflow-hidden">
        <DiagramThumb preview={card.preview} className="w-full h-full" />
      </div>
      <div className="px-4 pt-3 pb-3.5">
        <h3 className="text-[14.5px] font-semibold text-ink truncate pr-8">{card.name}</h3>
        {showPath && (
          <p className="text-[12px] text-muted truncate">
            {card.workspaceName} › {card.projectName}
          </p>
        )}
        <p className="mt-1 text-[12px] text-muted">
          {card.nodeCount} component{card.nodeCount === 1 ? '' : 's'} · {card.edgeCount} connection{card.edgeCount === 1 ? '' : 's'} · {timeAgo(card.updatedAt)}
        </p>
      </div>
    </button>
    {extra}
  </div>
);
