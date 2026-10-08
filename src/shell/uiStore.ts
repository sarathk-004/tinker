import { create } from 'zustand';

export type Tool = 'pan' | 'select' | 'text';
export type RightTab = 'chat' | 'components';

/** View-only state of the shell (never saved, never sent to the server). */
interface UiState {
  /** Pan (default): drag on empty canvas moves the view. Select: drag draws a selection box. Text: click the canvas to drop a note. */
  tool: Tool;
  paletteOpen: boolean;
  /** The "Version history" section of the left column is expanded. */
  versionsOpen: boolean;
  /** Narrow screens: the left column and the right panel slide over the canvas instead of sitting beside it. */
  navOpen: boolean;
  chatOpen: boolean;
  /** Which tab of the right panel is showing. */
  rightTab: RightTab;
  /** The node whose properties dialog is open. */
  editingNodeId: string | null;
  /** The canvas note whose text is being typed. */
  editingNoteId: string | null;
  /** The group whose name is being typed (its full path), and the one selected on the canvas. */
  editingGroupPath: string | null;
  selectedGroupPath: string | null;
  helpOpen: boolean;
  settingsOpen: boolean;
  set(patch: Partial<Omit<UiState, 'set'>>): void;
}

export const useUi = create<UiState>((set) => ({
  tool: 'pan',
  paletteOpen: false,
  versionsOpen: false,
  navOpen: false,
  chatOpen: false,
  rightTab: 'chat',
  editingNodeId: null,
  editingNoteId: null,
  editingGroupPath: null,
  selectedGroupPath: null,
  helpOpen: false,
  settingsOpen: false,
  set: (patch) => set(patch),
}));

/** Show the right panel on a tab, also on narrow screens where it is a drawer. */
export function openRightTab(tab: RightTab): void {
  useUi.getState().set({ rightTab: tab, chatOpen: true });
}
