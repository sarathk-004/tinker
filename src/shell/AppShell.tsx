import React, { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AiKeyDialog } from '../components/AiKeyDialog';
import { DiagramCanvas } from '../components/DiagramCanvas';
import { NodeEditModal } from '../components/NodeEditModal';
import { StatusBanners } from '../components/StatusBanners';
import { CanvasHeader } from './CanvasHeader';
import { CanvasToolbar } from './CanvasToolbar';
import { RightPanel } from './RightPanel';
import { useShortcuts } from './shortcuts';
import { CommandPalette } from './CommandPalette';
import { LeftNav } from './LeftNav';
import { NodeBar, StatusFooter } from './NodeBar';
import { TopBar } from './TopBar';
import { useUi } from './uiStore';

/**
 * The signed-in app: top bar, left column (diagrams, versions, advisor), the canvas with its header and tools, and the chat on the right.
 * Below 1024 px the left column and below 1280 px the chat slide over the canvas instead of sitting beside it.
 */
/** The provider lives here so everything inside (toolbar, search, shortcuts) can move and measure the same canvas. */
export const AppShell: React.FC = () => (
  <ReactFlowProvider>
    <ShellBody />
  </ReactFlowProvider>
);

const ShellBody: React.FC = () => {
  useShortcuts();
  const navOpen = useUi((s) => s.navOpen);
  const chatOpen = useUi((s) => s.chatOpen);
  const editingNodeId = useUi((s) => s.editingNodeId);

  // Cmd/Ctrl+K opens search from anywhere (also while typing: it is the one shortcut people expect to work everywhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUi.getState().set({ paletteOpen: !useUi.getState().paletteOpen });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="flex flex-col w-screen h-screen bg-[#f7f7f4] text-[#26251e] overflow-hidden select-none font-sans">
        <TopBar />
        <StatusBanners />
        <AiKeyDialog />

        <div className="flex flex-1 min-h-0 w-full overflow-hidden relative">
          <div className="hidden lg:block h-full flex-shrink-0">
            <LeftNav />
          </div>

          <main className="relative flex-1 min-w-0 flex flex-col bg-[#f7f7f4]">
            <CanvasHeader />
            <CanvasToolbar />
            <div className="relative flex-1 min-h-0">
              <DiagramCanvas />
              <NodeBar />
            </div>
            <StatusFooter />
          </main>

          <div className="hidden xl:block h-full flex-shrink-0">
            <RightPanel />
          </div>
        </div>

        {navOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="h-full shadow-2xl animate-fade-in"><LeftNav overlay /></div>
            <button aria-label="Close navigation" className="flex-1 bg-[#26251e]/25" onClick={() => useUi.getState().set({ navOpen: false })} />
          </div>
        )}
        {chatOpen && (
          <div className="fixed inset-0 z-40 flex justify-end xl:hidden" role="dialog" aria-modal="true" aria-label="Chat">
            <button aria-label="Close chat" className="flex-1 bg-[#26251e]/25" onClick={() => useUi.getState().set({ chatOpen: false })} />
            <div className="h-full shadow-2xl animate-fade-in max-w-full"><RightPanel overlay /></div>
          </div>
        )}

        <CommandPalette />
        {editingNodeId && <NodeEditModal nodeId={editingNodeId} onClose={() => useUi.getState().set({ editingNodeId: null })} />}
      </div>
    </>
  );
};
