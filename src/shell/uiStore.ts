import { create } from 'zustand';

/** View-only state of the shell (never saved, never sent to the server). */
interface UiState {
  /** Select: drag on empty canvas draws a selection box. Pan: drag moves the canvas (hold Space for this in select mode). */
  tool: 'select' | 'pan';
  paletteOpen: boolean;
  /** The "Version history" section of the left column is expanded. */
  versionsOpen: boolean;
  /** Narrow screens: the left column and the chat panel slide over the canvas instead of sitting beside it. */
  navOpen: boolean;
  chatOpen: boolean;
  /** The node whose properties dialog is open. */
  editingNodeId: string | null;
  helpOpen: boolean;
  set(patch: Partial<Omit<UiState, 'set'>>): void;
}

export const useUi = create<UiState>((set) => ({
  tool: 'select',
  paletteOpen: false,
  versionsOpen: false,
  navOpen: false,
  chatOpen: false,
  editingNodeId: null,
  helpOpen: false,
  set: (patch) => set(patch),
}));
