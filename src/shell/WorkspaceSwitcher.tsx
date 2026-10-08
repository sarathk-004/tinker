import React, { useState } from 'react';
import { Check, ChevronsUpDown, LayoutGrid, Loader2, Plus, Settings } from 'lucide-react';
import { useUi } from './uiStore';
import { LIMITS } from '../contracts';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { MENU_ITEM, MENU_PANEL, MONO_LABEL, useDismiss } from './Popover';

/** "Acme engineering [TEAM]": which workspace's diagrams you are working in. Switching saves what is open first. */
export const WorkspaceSwitcher: React.FC = () => {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = React.useCallback(() => {
    setOpen(false);
    setCreating(false);
    setError(null);
  }, []);
  const ref = useDismiss(open, close);
  if (!workspace) return null;

  const ownedTeams = workspaces.filter((w) => !w.personal && w.role === 'OWNER').length;
  const atLimit = ownedTeams >= LIMITS.maxOwnedWorkspaces;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const problem = await useWorkspaceStore.getState().createWorkspace(name);
    setBusy(false);
    if (problem) setError(problem);
    else {
      setName('');
      close();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch workspace"
        className="flex items-center gap-2 h-9 pl-2.5 pr-2 rounded-lg hover:bg-canvas border border-transparent hover:border-line transition-colors"
      >
        <span className="text-[15px] font-medium tracking-[-0.01em] text-ink max-w-[200px] truncate">{workspace.name}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-muted" />
        <span className="px-1.5 py-0.5 rounded-md bg-fill font-mono text-[10px] uppercase tracking-[0.08em] text-body">{workspace.personal ? 'Personal' : 'Team'}</span>
      </button>

      {open && (
        <div role="menu" className={`${MENU_PANEL} left-0 top-full mt-2 w-72`}>
          <div className={`px-2.5 pt-1.5 pb-1 ${MONO_LABEL}`}>Workspaces</div>
          <div className="max-h-64 overflow-y-auto">
            {workspaces.map((w) => (
              <button
                key={w.id}
                role="menuitemradio"
                aria-checked={w.id === workspace.id}
                onClick={() => {
                  close();
                  void useWorkspaceStore.getState().openWorkspace(w.id);
                }}
                className={MENU_ITEM}
              >
                <span className="w-4">{w.id === workspace.id && <Check className="w-4 h-4 text-primary" />}</span>
                <span className="flex-1 truncate font-medium">{w.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{w.personal ? 'Personal' : w.role.toLowerCase()}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-fill mt-1 pt-1">
            <button onClick={() => { close(); useUi.getState().set({ view: 'dashboard' }); }} className={MENU_ITEM}>
              <LayoutGrid className="w-4 h-4 text-body" /> Dashboard
            </button>
            <button onClick={() => { close(); useUi.getState().set({ workspaceSettingsId: workspace.id }); }} className={MENU_ITEM}>
              <Settings className="w-4 h-4 text-body" /> Workspace settings
            </button>
          </div>
          <div className="border-t border-fill mt-1 pt-1">
            {creating ? (
              <form onSubmit={create} className="p-1.5 space-y-2">
                <input
                  autoFocus
                  value={name}
                  maxLength={LIMITS.maxWorkspaceNameLength}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Workspace name"
                  aria-label="Workspace name"
                  className="w-full h-9 px-3 rounded-lg border border-line bg-surface text-[13px] outline-none focus:border-ink"
                />
                {error && <p className="text-[12px] text-danger">{error}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={busy || !name.trim()} className="flex-1 h-8 rounded-lg bg-primary hover:bg-primary-hover disabled:bg-line disabled:text-faint text-white text-[13px] font-medium flex items-center justify-center gap-1.5">
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
                  </button>
                  <button type="button" onClick={() => setCreating(false)} className="h-8 px-3 rounded-lg border border-line text-[13px] hover:bg-canvas">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setCreating(true)} disabled={atLimit} className={MENU_ITEM} title={atLimit ? `You can own up to ${LIMITS.maxOwnedWorkspaces} team workspaces.` : undefined}>
                <Plus className="w-4 h-4 text-primary" /> Create team workspace
                {atLimit && <span className="ml-auto text-[11px] text-muted">limit reached</span>}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
