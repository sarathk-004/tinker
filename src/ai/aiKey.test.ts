import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiKeyStatus } from '../contracts';

const h = vi.hoisted(() => ({
  api: {
    aiKey: vi.fn(),
    saveAiKey: vi.fn(),
    removeAiKey: vi.fn(),
    me: vi.fn(),
  },
  setFeatures: vi.fn(),
}));

vi.mock('../document/instance', () => ({ api: h.api }));
vi.mock('../workspace/workspaceStore', () => ({ useWorkspaceStore: { setState: h.setFeatures } }));

import { ApiError } from '../api/client';
import { useSpeechSettings } from '../voice/speech';
import { useAiKeyStore } from './aiKey';

const status = (over: Partial<AiKeyStatus> = {}): AiKeyStatus => ({ mode: 'user', source: 'NONE', configured: false, last4: null, addedAt: null, verifiedAt: null, ...over });
const KEY = 'AIzaSyExampleExampleExample0123456789';

beforeEach(() => {
  vi.clearAllMocks();
  useAiKeyStore.setState({ open: false, status: null, busy: false, error: null, notice: null });
  useSpeechSettings.setState({ serverCanSpeak: false });
  h.api.me.mockResolvedValue({ features: { aiCommands: true, aiModel: true, voice: true, speech: true, aiKey: { mode: 'user', source: 'USER' } } });
});

describe('your own AI key', () => {
  it('opening the dialog loads the status', async () => {
    h.api.aiKey.mockResolvedValue(status());
    useAiKeyStore.getState().show();
    await vi.waitFor(() => expect(useAiKeyStore.getState().status).toEqual(status()));
    expect(useAiKeyStore.getState().open).toBe(true);
  });

  it('saving sends the key once, then refreshes what the AI can do (including spoken replies), and keeps nothing of the key', async () => {
    h.api.saveAiKey.mockResolvedValue(status({ source: 'USER', configured: true, last4: '6789', verifiedAt: '2026-10-06T12:00:00.000Z' }));
    expect(await useAiKeyStore.getState().save(`  ${KEY}  `)).toBe(true);
    expect(h.api.saveAiKey).toHaveBeenCalledWith(KEY); // trimmed
    expect(h.api.me).toHaveBeenCalledTimes(1);
    expect(h.setFeatures).toHaveBeenCalledWith({ features: expect.objectContaining({ aiModel: true, voice: true }) });
    expect(useSpeechSettings.getState().serverCanSpeak).toBe(true);
    const state = useAiKeyStore.getState();
    expect(state).toMatchObject({ busy: false, error: null });
    expect(state.notice).toMatch(/saved/i);
    expect(JSON.stringify(state)).not.toContain(KEY); // the store never holds the key
    expect(state.status?.last4).toBe('6789');
  });

  it('a refused key shows Google\'s verdict in plain words and changes nothing else', async () => {
    h.api.saveAiKey.mockRejectedValue(new ApiError('DOMAIN_VALIDATION_FAILED', 'Google did not accept that key. Check that you copied the whole key from Google AI Studio and that it is enabled.', 422));
    expect(await useAiKeyStore.getState().save(KEY)).toBe(false);
    expect(useAiKeyStore.getState().error).toMatch(/did not accept that key/);
    expect(h.api.me).not.toHaveBeenCalled();
    expect(JSON.stringify(useAiKeyStore.getState())).not.toContain(KEY);
  });

  it('rate limits and network trouble get their own wording', async () => {
    h.api.saveAiKey.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'x', 429));
    await useAiKeyStore.getState().save(KEY);
    expect(useAiKeyStore.getState().error).toMatch(/too many attempts/i);
    h.api.saveAiKey.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'x', 0));
    await useAiKeyStore.getState().save(KEY);
    expect(useAiKeyStore.getState().error).toMatch(/nothing was saved/i);
  });

  it('removing switches the AI off again and says so', async () => {
    h.api.removeAiKey.mockResolvedValue(status());
    h.api.me.mockResolvedValue({ features: { aiCommands: true, aiModel: false, voice: false, speech: false, aiKey: { mode: 'user', source: 'NONE' } } });
    useSpeechSettings.setState({ serverCanSpeak: true });
    expect(await useAiKeyStore.getState().remove()).toBe(true);
    expect(useSpeechSettings.getState().serverCanSpeak).toBe(false);
    expect(useAiKeyStore.getState().notice).toMatch(/removed/i);
    expect(useAiKeyStore.getState().status?.configured).toBe(false);
  });

  it('two saves at once are not sent twice', async () => {
    let release!: () => void;
    h.api.saveAiKey.mockReturnValue(new Promise((resolve) => (release = () => resolve(status({ source: 'USER', configured: true, last4: '6789' })))));
    const first = useAiKeyStore.getState().save(KEY);
    expect(await useAiKeyStore.getState().save(KEY)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(h.api.saveAiKey).toHaveBeenCalledTimes(1);
  });

  it('closing the dialog clears messages', () => {
    useAiKeyStore.setState({ open: true, error: 'x', notice: 'y' });
    useAiKeyStore.getState().hide();
    expect(useAiKeyStore.getState()).toMatchObject({ open: false, error: null, notice: null });
  });
});
