import { create } from 'zustand';
import type { AiKeyStatus } from '../contracts';
import { ApiError } from '../api/client';
import { api } from '../document/instance';
import { useSpeechSettings } from '../voice/speech';
import { useWorkspaceStore } from '../workspace/workspaceStore';

/**
 * The person's own model API key (decision I9-BYOK). The browser only ever SENDS the key once, over HTTPS, when it is saved; it is
 * never stored in the browser (no localStorage, no URL), never shown again (only its last four characters) and never logged.
 */
interface AiKeyState {
  open: boolean;
  status: AiKeyStatus | null;
  busy: boolean;
  error: string | null;
  notice: string | null;

  show(): void;
  hide(): void;
  load(): Promise<void>;
  save(apiKey: string): Promise<boolean>;
  remove(): Promise<boolean>;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') return 'Too many attempts. Please wait a minute and try again.';
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') return 'Cannot reach the server right now. Nothing was saved.';
    return error.message;
  }
  return 'Something went wrong. Nothing was saved.';
};

/** What this person's AI can do changed (key added or removed): re-read the capabilities so the buttons match. */
async function refreshFeatures(): Promise<void> {
  const me = await api.me();
  useWorkspaceStore.setState({ features: me.features });
  useSpeechSettings.setState({ serverCanSpeak: me.features.speech });
}

export const useAiKeyStore = create<AiKeyState>((set, get) => ({
  open: false,
  status: null,
  busy: false,
  error: null,
  notice: null,

  show: () => {
    set({ open: true, error: null, notice: null });
    void get().load();
  },
  hide: () => set({ open: false, error: null, notice: null }),

  async load() {
    try {
      set({ status: await api.aiKey() });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async save(apiKey) {
    if (get().busy) return false;
    set({ busy: true, error: null, notice: null });
    try {
      const status = await api.saveAiKey(apiKey.trim());
      set({ status, notice: 'Key checked and saved. AI commands, voice and spoken replies now run on your key.' });
      await refreshFeatures();
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async remove() {
    if (get().busy) return false;
    set({ busy: true, error: null, notice: null });
    try {
      const status = await api.removeAiKey();
      set({ status, notice: 'Your key was removed from the server.' });
      await refreshFeatures();
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));
