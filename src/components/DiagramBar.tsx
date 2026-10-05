import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Cloud, CloudOff, Loader2, LogOut, Plus, Trash2 } from 'lucide-react';
import { useDiagramStore } from '../diagram/store';
import { session } from '../document/instance';
import { signOut, useAuthStore } from '../auth/auth';
import { useWorkspaceStore } from '../workspace/workspaceStore';

/** Saved / Saving / Not saved / Conflict: the one place the user learns whether their work is safe. */
export const SaveBadge: React.FC = () => {
  const { status, pending } = useDiagramStore((s) => s.doc);
  const base = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border';
  if (status === 'conflict') {
    return <span className={`${base} bg-[#cf2d56]/10 text-[#cf2d56] border-[#cf2d56]/30`}><AlertTriangle className="w-3 h-3" />Changed elsewhere</span>;
  }
  if (status === 'blocked') {
    return <span className={`${base} bg-[#cf2d56]/10 text-[#cf2d56] border-[#cf2d56]/30`}><CloudOff className="w-3 h-3" />Unavailable</span>;
  }
  if (status === 'failed') {
    return (
      <button onClick={() => session.retry()} className={`${base} bg-[#c08532]/15 text-[#8a5a12] border-[#c08532]/40 hover:bg-[#c08532]/25`} title="Retry saving now">
        <CloudOff className="w-3 h-3" />Not saved · Retry
      </button>
    );
  }
  if (status === 'saving' || pending > 0) {
    return <span className={`${base} bg-white text-[#5a5852] border-[#e6e5e0]`}><Loader2 className="w-3 h-3 animate-spin" />Saving{pending > 1 ? ` (${pending})` : '…'}</span>;
  }
  return <span className={`${base} bg-[#e7f5ec] text-[#1a7f37] border-[#1a7f37]/20`}><Check className="w-3 h-3" />Saved</span>;
};

export const DiagramBar: React.FC = () => {
  const diagram = useDiagramStore((s) => s.doc.diagram);
  const { diagrams } = useWorkspaceStore();
  const { openDiagram, createDiagram, renameDiagram, deleteCurrent } = useWorkspaceStore.getState();
  const email = useAuthStore((s) => s.email);

  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setAccountOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim()) void renameDiagram(draft);
  };

  return (
    <div ref={rootRef} className="flex items-center gap-2 relative">
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={160}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setEditing(false);
          }}
          aria-label="Diagram name"
          className="px-2 py-1 text-sm rounded-md border border-[#26251e] bg-white text-[#26251e] outline-none w-56"
        />
      ) : (
        <button
          onClick={() => {
            setDraft(diagram?.name ?? '');
            setEditing(true);
          }}
          disabled={!diagram}
          title="Rename diagram"
          className="px-2 py-1 text-sm font-medium text-[#26251e] rounded-md hover:bg-white border border-transparent hover:border-[#e6e5e0] max-w-[260px] truncate"
        >
          {diagram?.name ?? 'No diagram'}
        </button>
      )}

      <button
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Switch diagram"
        className="p-1 rounded-md text-[#5a5852] hover:bg-white border border-transparent hover:border-[#e6e5e0]"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      <SaveBadge />

      {menuOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 p-1.5 rounded-md bg-white border border-[#e6e5e0] shadow-md z-50 animate-fade-in">
          <div className="px-2 py-1 text-[11px] font-mono font-medium text-[#807d72] uppercase tracking-wider">Your diagrams</div>
          <div className="max-h-64 overflow-y-auto">
            {diagrams.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  setMenuOpen(false);
                  void openDiagram(d.id);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-[#fafaf7] ${d.id === diagram?.id ? 'bg-[#fafaf7] font-semibold' : ''}`}
              >
                <div className="truncate">{d.name}</div>
                <div className="text-[10px] text-[#807d72]">Updated {new Date(d.updatedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
          <div className="border-t border-[#e6e5e0] mt-1 pt-1">
            <button
              onClick={() => {
                setMenuOpen(false);
                void createDiagram();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-[#fafaf7]"
            >
              <Plus className="w-3.5 h-3.5 text-[#f54e00]" /> New diagram
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm(`Delete "${diagram?.name}"? You can ask support to restore it within 30 days.`)) void deleteCurrent();
              }}
              disabled={!diagram}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-[#cf2d56] hover:bg-[#cf2d56]/10 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete this diagram
            </button>
          </div>
        </div>
      )}

      <div className="relative ml-1">
        <button
          onClick={() => setAccountOpen((o) => !o)}
          title={email ?? 'Account'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#26251e] bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] rounded-md"
        >
          <Cloud className="w-3.5 h-3.5 text-[#f54e00]" />
          <span className="hidden md:inline max-w-[140px] truncate">{email ?? 'Account'}</span>
        </button>
        {accountOpen && (
          <div className="absolute top-full right-0 mt-2 w-52 p-1.5 rounded-md bg-white border border-[#e6e5e0] shadow-md z-50">
            <div className="px-2.5 py-1.5 text-[11px] text-[#807d72] truncate">{email}</div>
            <button
              onClick={() => {
                setAccountOpen(false);
                void signOut();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-[#fafaf7]"
            >
              <LogOut className="w-3.5 h-3.5 text-[#5a5852]" /> Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
