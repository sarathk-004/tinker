import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { DiagramCard } from '../contracts';
import { DiagramIcon } from '../components/DiagramIcon';
import { DiagramThumb } from '../components/DiagramThumb';
import { timeAgo } from '../components/VersionsPanel';
import { useWorkspaceStore } from '../workspace/workspaceStore';

/** The landing pages sit on a cutting-mat grid. */
export const PageFrame: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({ children, wide = false }) => (
  <main id="main" tabIndex={-1} className="relative flex-1 min-h-0 overflow-y-auto bg-canvas outline-none">
    {/* The grid stays put while the page scrolls, and fades in under the navbar so no line touches its edge. */}
    <div aria-hidden className="sticky top-0 z-0 h-0 pointer-events-none">
      <div className="cutting-mat h-screen [mask-image:linear-gradient(to_bottom,transparent,black_96px)]" />
    </div>
    <div className={`relative z-10 mx-auto w-full px-5 sm:px-8 py-8 ${wide ? 'max-w-[96rem]' : 'max-w-6xl'}`}>{children}</div>
  </main>
);

export interface Crumb {
  label: string;
  go?: () => void;
}

/** "Dashboard > Payments > Checkout": every part but the last is a way back. */
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

/** The drawing of a diagram on a plain panel (a diagram has an icon, not a cover); an empty diagram shows its icon large. */
export const DiagramPreview: React.FC<{ card: DiagramCard; className?: string }> = ({ card, className = '' }) => (
  <div className={`img-outline relative overflow-hidden bg-canvas flex items-center justify-center ${className}`}>
    {card.preview.nodes.length > 0 ? <DiagramThumb preview={card.preview} className="w-full h-full p-2" /> : <DiagramIcon icon={card.icon} size={44} />}
  </div>
);

/** A diagram as a card: a drawing of its layout, its icon and name, how big it is, where it lives and when it changed. */
export const DiagramCardView: React.FC<{ card: DiagramCard; showPath?: boolean; extra?: React.ReactNode }> = ({ card, showPath = false, extra }) => (
  <div className="group relative rounded-[20px] bg-surface lifted lifted-hover transition-shadow">
    <button onClick={() => void openCard(card)} data-sound="lift" className="w-full text-left rounded-[20px]" aria-label={`Open ${card.name}`}>
      <DiagramPreview card={card} className="h-32 m-2 mb-0 rounded-xl" />
      <div className="px-4 pt-3 pb-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <DiagramIcon icon={card.icon} size={24} />
          <h3 className="text-[14.5px] font-semibold text-ink truncate">{card.name}</h3>
        </div>
        {showPath && (
          <p className="mt-1 text-[12px] text-muted truncate">
            {card.workspaceName} › {card.projectName}
          </p>
        )}
        <p className="tabular mt-1 text-[12px] text-muted">
          {card.nodeCount} component{card.nodeCount === 1 ? '' : 's'} · {card.edgeCount} connection{card.edgeCount === 1 ? '' : 's'} · {timeAgo(card.updatedAt)}
        </p>
      </div>
    </button>
    {extra}
  </div>
);

/** A diagram as a compact row (its icon, name, where it lives, when it changed): for the stack of recents. */
export const DiagramRow: React.FC<{ card: DiagramCard }> = ({ card }) => (
  <button onClick={() => void openCard(card)} data-sound="lift" aria-label={`Open ${card.name}`} className="group w-full text-left rounded-2xl bg-surface lifted lifted-hover transition-shadow p-2.5 flex items-center gap-3">
    <DiagramIcon icon={card.icon} size={44} />
    <span className="min-w-0 flex-1">
      <span className="block text-[13.5px] font-semibold text-ink truncate">{card.name}</span>
      <span className="block mt-0.5 text-[11.5px] text-muted truncate">
        {card.workspaceName} › {card.projectName}
      </span>
      <span className="tabular block text-[11.5px] text-muted">
        {card.nodeCount} component{card.nodeCount === 1 ? '' : 's'} · {timeAgo(card.updatedAt)}
      </span>
    </span>
  </button>
);
