import React, { useState } from 'react';
import { HelpCircle, KeyRound, LogOut, Menu, MessageSquare, Search } from 'lucide-react';
import { signOut, useAuthStore } from '../auth/auth';
import { useAiKeyStore } from '../ai/aiKey';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { TinkerLogo } from '../components/TinkerLogo';
import { MENU_ITEM, MENU_PANEL, MONO_LABEL, useDismiss } from './Popover';
import { useUi } from './uiStore';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

export const initialsOf = (email: string | null | undefined, name?: string | null): string => {
  const source = (name ?? '').trim() || (email ?? '').split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[1]?.[0] ?? '') : '')).toUpperCase();
};

export const Avatar: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = '' }) => {
  const email = useAuthStore((s) => s.email);
  const name = useWorkspaceStore((s) => s.user?.displayName);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.37) }}
      className={`inline-flex items-center justify-center rounded-full bg-[#26251e] text-white font-semibold tracking-normal flex-shrink-0 ${className}`}
    >
      {initialsOf(email, name)}
    </span>
  );
};

const SHORTCUTS: Array<[string, string]> = [
  [`${MOD_KEY} K`, 'Search diagrams, components and actions'],
  [`${MOD_KEY} Z`, 'Undo (saved as a new version)'],
  [`${MOD_KEY} ⇧ Z`, 'Redo'],
  ['Space + drag', 'Pan the canvas'],
  ['Scroll', 'Zoom'],
  ['Delete', 'Remove the selected components'],
  ['Enter', 'Send a message to Tinker'],
];

export const TopBar: React.FC = () => {
  const email = useAuthStore((s) => s.email);
  const keyMode = useWorkspaceStore((s) => s.features.aiKey.mode);
  const keySource = useWorkspaceStore((s) => s.features.aiKey.source);
  const [menu, setMenu] = useState(false);
  const closeMenu = React.useCallback(() => setMenu(false), []);
  const menuRef = useDismiss(menu, closeMenu);
  const helpOpen = useUi((s) => s.helpOpen);
  const closeHelp = React.useCallback(() => useUi.getState().set({ helpOpen: false }), []);
  const helpRef = useDismiss(helpOpen, closeHelp);

  return (
    <header className="h-14 flex-shrink-0 flex items-center gap-3 pl-4 pr-4 border-b border-[#e6e5e0] bg-white z-30">
      <button onClick={() => useUi.getState().set({ navOpen: true })} aria-label="Open navigation" className="lg:hidden p-1.5 -ml-1 rounded-lg text-[#5a5852] hover:bg-[#f7f7f4]">
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <TinkerLogo size={26} />
        <span className="text-[20px] font-semibold tracking-[-0.03em] text-[#26251e]">Tinker</span>
      </div>
      <div className="hidden sm:block h-6 w-px bg-[#e6e5e0]" />
      <WorkspaceSwitcher />

      <div className="flex-1" />

      <button
        onClick={() => useUi.getState().set({ paletteOpen: true })}
        aria-label="Search"
        className="hidden md:flex items-center gap-2.5 h-9 w-[300px] lg:w-[340px] px-3 rounded-lg border border-[#e6e5e0] bg-[#f7f7f4] hover:bg-white hover:border-[#cfcdc4] text-left transition-colors"
      >
        <Search className="w-4 h-4 text-[#807d72]" />
        <span className="flex-1 text-[13.5px] text-[#807d72] truncate">Search diagrams, components…</span>
        <kbd className="font-mono text-[10.5px] text-[#807d72] px-1.5 py-0.5 rounded-md border border-[#e6e5e0] bg-white">{MOD_KEY} K</kbd>
      </button>
      <button onClick={() => useUi.getState().set({ paletteOpen: true })} aria-label="Search" className="md:hidden p-2 rounded-lg text-[#5a5852] hover:bg-[#f7f7f4]">
        <Search className="w-[18px] h-[18px]" />
      </button>

      <div ref={helpRef} className="relative">
        <button onClick={() => useUi.getState().set({ helpOpen: !helpOpen })} aria-label="Help and shortcuts" aria-expanded={helpOpen} className="p-2 rounded-lg text-[#5a5852] hover:bg-[#f7f7f4] hover:text-[#26251e]">
          <HelpCircle className="w-[18px] h-[18px]" />
        </button>
        {helpOpen && (
          <div className={`${MENU_PANEL} right-0 top-full mt-2 w-80 p-3`}>
            <div className={`${MONO_LABEL} mb-2`}>Shortcuts</div>
            <dl className="space-y-1.5">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3 text-[13px]">
                  <dt className="text-[#5a5852]">{what}</dt>
                  <dd><kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded-md border border-[#e6e5e0] bg-[#fafaf7] whitespace-nowrap">{keys}</kbd></dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 pt-3 border-t border-[#efeee8] text-[12.5px] leading-relaxed text-[#5a5852]">
              Tell Tinker what to change in plain words, for example <em>put Redis between Orders and PostgreSQL</em>. Questions ending in ? are answered without changing anything.
            </p>
          </div>
        )}
      </div>

      <button onClick={() => useUi.getState().set({ chatOpen: !useUi.getState().chatOpen })} aria-label="Toggle chat" className="xl:hidden p-2 rounded-lg text-[#5a5852] hover:bg-[#f7f7f4]">
        <MessageSquare className="w-[18px] h-[18px]" />
      </button>

      <div ref={menuRef} className="relative">
        <button onClick={() => setMenu((o) => !o)} aria-label="Account" aria-haspopup="menu" aria-expanded={menu} title={email ?? 'Account'} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f54e00]">
          <Avatar />
        </button>
        {menu && (
          <div role="menu" className={`${MENU_PANEL} right-0 top-full mt-2 w-64`}>
            <div className="px-2.5 py-2">
              <div className="text-[13px] font-medium text-[#26251e] truncate">{email}</div>
              <div className="text-[12px] text-[#807d72]">Signed in</div>
            </div>
            {keyMode !== 'server' && (
              <button
                onClick={() => {
                  setMenu(false);
                  useAiKeyStore.getState().show();
                }}
                className={MENU_ITEM}
              >
                <KeyRound className="w-4 h-4 text-[#5a5852]" /> {keySource === 'NONE' ? 'Add AI key' : 'AI key'}
              </button>
            )}
            <button
              onClick={() => {
                setMenu(false);
                void signOut();
              }}
              className={MENU_ITEM}
            >
              <LogOut className="w-4 h-4 text-[#5a5852]" /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
