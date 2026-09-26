import React, { useState } from 'react';
import { Header } from './components/Header';
import { DiagramCanvas } from './components/DiagramCanvas';
import { ManualToolbar } from './components/ManualToolbar';
import { CommandBar } from './components/CommandBar';
import { SettingsModal } from './components/SettingsModal';
import { SidebarPanel } from './components/SidebarPanel';
import { useDiagramStore } from './diagram/store';

export const App: React.FC = () => {
  const [layoutDir, setLayoutDir] = useState<'LR' | 'TB'>('LR');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const applyLayout = useDiagramStore((s) => s.applyLayout);

  const toggleLayout = () => {
    const next = layoutDir === 'LR' ? 'TB' : 'LR';
    setLayoutDir(next);
    applyLayout(next);
  };

  return (
    <div className="flex flex-col w-screen h-screen bg-[#f7f7f4] text-[#26251e] overflow-hidden select-none font-sans">
      <Header
        layoutDir={layoutDir}
        onToggleLayout={toggleLayout}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="relative flex-1 w-full h-full overflow-hidden">
        <SidebarPanel />
        <DiagramCanvas />
        <ManualToolbar />
        <CommandBar onOpenSettings={() => setSettingsOpen(true)} />
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
};

export default App;
