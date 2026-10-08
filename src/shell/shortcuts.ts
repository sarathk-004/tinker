import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDiagramStore } from '../diagram/store';
import { toggleFullscreen } from './fullscreen';
import { openRightTab, useUi } from './uiStore';

export type ShortcutAction = 'select' | 'pan' | 'text' | 'fit' | 'components' | 'rename' | 'group' | 'fullscreen' | 'tidy' | 'help' | 'chat';

/** What each single key does, in the order the help panel lists them. */
export const SHORTCUT_KEYS: ReadonlyArray<{ key: string; action: ShortcutAction; label: string }> = [
  { key: 'H', action: 'pan', label: 'Pan tool (Space also pans)' },
  { key: 'V', action: 'select', label: 'Select tool (drag a box around components)' },
  { key: 'T', action: 'text', label: 'Text tool: click the canvas to add a note' },
  { key: 'C', action: 'components', label: 'Open the Components tab' },
  { key: 'R', action: 'rename', label: 'Rename or edit the selected component' },
  { key: 'G', action: 'group', label: 'Group the selected components' },
  { key: 'K', action: 'fit', label: 'Resize the view to fit the whole diagram' },
  { key: 'L', action: 'tidy', label: 'Tidy the layout' },
  { key: 'F', action: 'fullscreen', label: 'Full screen' },
  { key: '/', action: 'chat', label: 'Jump to the message box' },
  { key: '?', action: 'help', label: 'Show shortcuts' },
];

export interface KeyInfo {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** The key was pressed while typing in a box, so it is text and not a command. */
  typing: boolean;
}

/** Pure: which shortcut (if any) a key press is. Never while typing, and never together with Ctrl, Cmd or Alt (those belong to the browser and to undo). */
export function actionForKey(e: KeyInfo): ShortcutAction | null {
  if (e.typing || e.metaKey || e.ctrlKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return SHORTCUT_KEYS.find((s) => s.key === k)?.action ?? null;
}

export const isTypingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

/** Registers the single-key shortcuts. Lives inside the React Flow provider so it can resize the view. */
export function useShortcuts(): void {
  const flow = useReactFlow();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = actionForKey({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, typing: isTypingTarget(e.target) });
      if (!action) return;
      const store = useDiagramStore.getState();
      const ui = useUi.getState();
      const hasDiagram = store.doc.diagram !== null;
      e.preventDefault();
      switch (action) {
        case 'pan':
        case 'select':
        case 'text':
          return ui.set({ tool: action });
        case 'fit':
          return void flow.fitView({ padding: 0.25, duration: 300, maxZoom: 1 });
        case 'components':
          return openRightTab('components');
        case 'rename':
          // Only with exactly one component selected: with nothing selected there is nothing to rename.
          return store.selectedNodeIds.length === 1 ? ui.set({ editingNodeId: store.selectedNodeIds[0]! }) : undefined;
        case 'group':
          return store.selectedNodeIds.length >= 2 ? void store.groupNodes(store.selectedNodeIds, 'New group') : undefined;
        case 'fullscreen':
          return void toggleFullscreen();
        case 'tidy':
          return hasDiagram && store.nodes.length > 0 ? void store.applyLayout() : undefined;
        case 'chat':
          openRightTab('chat');
          return void setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message to Tinker"]')?.focus(), 50);
        case 'help':
          return ui.set({ helpOpen: !ui.helpOpen });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow]);
}
