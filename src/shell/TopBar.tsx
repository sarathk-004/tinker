import React, { useEffect, useState } from 'react';
import { HelpCircle, KeyRound, LogOut, Menu, MessageSquare, Search, Settings } from 'lucide-react';
import { avatarCache, avatarListeners, loadAvatar } from '../auth/account';
import { signOut, useAuthStore } from '../auth/auth';
import { useAiKeyStore } from '../ai/aiKey';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { TinkerLogo } from '../components/TinkerLogo';
import { MENU_ITEM, MENU_PANEL, MONO_LABEL, useDismiss } from './Popover';
import { SHORTCUT_KEYS } from './shortcuts';
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
  const stamp = useWorkspaceStore((s) => s.user?.avatarUpdatedAt ?? null);
  const [, bump] = useState(0);
  const [url, setUrl] = useState<string | null>(avatarCache.stamp === stamp ? avatarCache.url : null);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    avatarListeners.add(again);
    return () => void avatarListeners.delete(again);
  }, []);
  useEffect(() => {
    let live = true;
    loadAvatar(stamp).then(
      (u) => live && setUrl(u),
      () => live && setUrl(null),
    );
    return () => void (live = false);
  }, [stamp, avatarCache.url]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.37) };
  if (url) return <img src={url} alt="" aria-hidden style={style} className={`rounded-full object-cover flex-shrink-0 ${className}`} />;
  return (
    <span aria-hidden style={style} className={`inline-flex items-center justify-center rounded-full bg-inverse text-on-inverse font-semibold tracking-normal flex-shrink-0 ${className}`}>
      {initialsOf(email, name)}
    </span>
  );
};

const SHORTCUTS: Array<[string, string]> = [
  [`${MOD_KEY} K`, 'Search diagrams, components and actions'],
  ...SHORTCUT_KEYS.map((s): [string, string] => [s.key, s.label]),
  [`${MOD_KEY} Z`, 'Undo (saved as a new version)'],
  [`${MOD_KEY} ⇧ Z`, 'Redo'],
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
    <header className="h-14 flex-shrink-0 flex items-center gap-3 pl-4 pr-4 border-b border-line bg-surface z-30">
      <button onClick={() => useUi.getState().set({ navOpen: true })} aria-label="Open navigation" className="lg:hidden p-1.5 -ml-1 rounded-lg text-body hover:bg-canvas">
        <Menu className="w-5 h-5" />
      </button>
      <button onClick={() => useUi.getState().set({ view: 'dashboard' })} title="All workspaces" aria-label="Tinker: all workspaces" className="flex items-center gap-2.5 flex-shrink-0 rounded-lg">
        <TinkerLogo size={26} />
        <span className="text-[20px] font-semibold tracking-[-0.03em] text-ink">tinker</span>
      </button>
      <div className="hidden sm:block h-6 w-px bg-line" />
      <WorkspaceSwitcher />

      <div className="flex-1" />

      <button
        onClick={() => useUi.getState().set({ paletteOpen: true })}
        aria-label="Search"
        className="hidden md:flex items-center gap-2.5 h-9 w-[300px] lg:w-[340px] px-3 rounded-lg border border-line bg-canvas hover:bg-surface hover:border-line-strong text-left transition-colors"
      >
        <Search className="w-4 h-4 text-muted" />
        <span className="flex-1 text-[13.5px] text-muted truncate">Search diagrams, components…</span>
        <kbd className="font-mono text-[10.5px] text-muted px-1.5 py-0.5 rounded-md border border-line bg-surface">{MOD_KEY} K</kbd>
      </button>
      <button onClick={() => useUi.getState().set({ paletteOpen: true })} aria-label="Search" className="md:hidden p-2 rounded-lg text-body hover:bg-canvas">
        <Search className="w-[18px] h-[18px]" />
      </button>

      <div ref={helpRef} className="relative">
        <button onClick={() => useUi.getState().set({ helpOpen: !helpOpen })} aria-label="Help and shortcuts" aria-expanded={helpOpen} className="p-2 rounded-lg text-body hover:bg-canvas hover:text-ink">
          <HelpCircle className="w-[18px] h-[18px]" />
        </button>
        {helpOpen && (
          <div className={`${MENU_PANEL} right-0 top-full mt-2 w-80 p-3`}>
            <div className={`${MONO_LABEL} mb-2`}>Shortcuts</div>
            <dl className="space-y-1.5">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3 text-[13px]">
                  <dt className="text-body">{what}</dt>
                  <dd><kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded-md border border-line bg-soft whitespace-nowrap">{keys}</kbd></dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 pt-3 border-t border-fill text-[12.5px] leading-relaxed text-body">
              Tell Tinker what to change in plain words, for example <em>put Redis between Orders and PostgreSQL</em>. Questions ending in ? are answered without changing anything.
            </p>
          </div>
        )}
      </div>

      <button onClick={() => useUi.getState().set({ chatOpen: !useUi.getState().chatOpen })} aria-label="Toggle chat" className="xl:hidden p-2 rounded-lg text-body hover:bg-canvas">
        <MessageSquare className="w-[18px] h-[18px]" />
      </button>

      <div ref={menuRef} className="relative">
        <button onClick={() => setMenu((o) => !o)} aria-label="Account" aria-haspopup="menu" aria-expanded={menu} title={email ?? 'Account'} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <Avatar />
        </button>
        {menu && (
          <div role="menu" className={`${MENU_PANEL} right-0 top-full mt-2 w-64`}>
            <div className="px-2.5 py-2">
              <div className="text-[13px] font-medium text-ink truncate">{email}</div>
              <div className="text-[12px] text-muted">Signed in</div>
            </div>
            <button
              onClick={() => {
                setMenu(false);
                useUi.getState().set({ settingsOpen: true });
              }}
              className={MENU_ITEM}
            >
              <Settings className="w-4 h-4 text-body" /> Settings
            </button>
            {keyMode !== 'server' && (
              <button
                onClick={() => {
                  setMenu(false);
                  useAiKeyStore.getState().show();
                }}
                className={MENU_ITEM}
              >
                <KeyRound className="w-4 h-4 text-body" /> {keySource === 'NONE' ? 'Add AI key' : 'AI key'}
              </button>
            )}
            <button
              onClick={() => {
                setMenu(false);
                void signOut();
              }}
              className={MENU_ITEM}
            >
              <LogOut className="w-4 h-4 text-body" /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
