import React from 'react';
import { Shapes, X } from 'lucide-react';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { TinkerLogo } from '../components/TinkerLogo';
import { ChatBody } from './ChatPanel';
import { ComponentsPanel } from './ComponentsPanel';
import { useUi, type RightTab } from './uiStore';

const Tab: React.FC<{ id: RightTab; active: RightTab; children: React.ReactNode }> = ({ id, active, children }) => (
  <button
    role="tab"
    aria-selected={id === active}
    onClick={() => useUi.getState().set({ rightTab: id })}
    className={`flex items-center gap-2 px-1 h-full text-[14px] font-medium border-b-2 -mb-px transition-colors ${id === active ? 'text-ink border-primary' : 'text-muted border-transparent hover:text-ink'}`}
  >
    {children}
  </button>
);

/** The right column: "Tinker" (the conversation) and "Components" (things to drag onto the canvas). */
export const RightPanel: React.FC<{ overlay?: boolean }> = ({ overlay = false }) => {
  const tab = useUi((s) => s.rightTab);
  const modelAvailable = useWorkspaceStore((s) => s.features.aiModel);
  return (
    <aside aria-label="Tinker" className="h-full w-[392px] max-w-full flex-shrink-0 flex flex-col bg-surface border-l border-line">
      <div role="tablist" className="h-12 flex-shrink-0 flex items-stretch justify-between pl-5 pr-2 border-b border-line">
        <div className="flex items-stretch gap-6">
          <Tab id="chat" active={tab}>
            <TinkerLogo size={18} /> tinker
            <span title={modelAvailable ? 'AI is on' : 'Plain commands only (no AI model on this server)'} className={`w-1.5 h-1.5 rounded-full ${modelAvailable ? 'bg-success' : 'bg-faint'}`} />
          </Tab>
          <Tab id="components" active={tab}>
            <Shapes className="w-4 h-4" /> Components
          </Tab>
        </div>
        {overlay && (
          <button onClick={() => useUi.getState().set({ chatOpen: false })} aria-label="Close panel" className="self-center p-2 rounded-lg text-body hover:bg-canvas xl:hidden"><X className="w-[18px] h-[18px]" /></button>
        )}
      </div>
      {tab === 'chat' ? <ChatBody /> : <ComponentsPanel />}
    </aside>
  );
};
