import { create } from 'zustand';
import type { VoiceResult } from '../contracts';
import { describeAiError, showOnDiagram, syncConversation } from '../ai/aiCommands';
import { useConversationStore } from '../ai/conversationStore';
import { authSource } from '../auth/auth';
import { config } from '../config';
import { api, session } from '../document/instance';
import { startMicrophone } from './capture';
import { speakReply, stopSpeaking, useSpeechSettings } from './speech';
import { VoiceClient, initialVoiceView, type SocketLike, type VoiceView } from './voiceClient';

export const useVoiceStore = create<VoiceView>(() => ({ ...initialVoiceView }));

const wsUrl = `${config.apiUrl.replace(/^http/, 'ws')}/v1/voice`;

/**
 * A voice result arrives from the server, which has already applied (or refused) it through the same service as typed
 * commands. The browser only reconciles: it shows the conversation turn, picks up the new diagram version, and highlights.
 */
function applyResult(result: VoiceResult, diagramId: string): void {
  if (session.getState().diagram?.id !== diagramId) return; // the user moved to another diagram meanwhile
  if (result.status === 'ERROR') {
    if (result.error.code === 'DIAGRAM_VERSION_CONFLICT') void session.refreshIfIdle();
    const turn = {
      id: `local-${crypto.randomUUID()}`,
      timestamp: Date.now(),
      role: 'assistant' as const,
      kind: 'error' as const,
      text: result.error.code === 'DIAGRAM_VERSION_CONFLICT' ? 'The diagram changed while you were speaking, so that request was not applied. Please say it again.' : result.error.message || describeAiError(null),
    };
    useConversationStore.getState().append([turn]);
    return;
  }
  void (async () => {
    // Pick up what the server committed (a no-op when something else is still saving: that path has its own conflict handling).
    await session.refreshIfIdle().catch(() => false);
    await syncConversation(diagramId);
    if (result.kind === 'ASK' && session.getState().diagram?.id === diagramId) showOnDiagram(result.response.analysis.affectedNodeIds);
    await readAloud(result.response.messages, diagramId);
  })();
}

/**
 * Read the assistant's reply to a spoken request aloud (answers, questions back, confirmations). The microphone is held back
 * while it plays so the assistant cannot hear itself.
 */
async function readAloud(messages: ReadonlyArray<{ id: string; role: string; content: string }>, diagramId: string): Promise<void> {
  const reply = [...messages].reverse().find((m) => m.role === 'ASSISTANT');
  if (!reply) return;
  voice.pauseAudio(true);
  try {
    await speakReply({
      text: reply.content,
      serverCanSpeak: useSpeechSettings.getState().serverCanSpeak,
      fetchAudio: async () => {
        const { audio, sampleRate } = await api.speak(diagramId, reply.id);
        return { audio, sampleRate };
      },
    });
  } finally {
    setTimeout(() => voice.pauseAudio(false), 400); // let the room echo of the last words die away before listening again
  }
}

export const voice = new VoiceClient({
  wsUrl,
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  capture: startMicrophone,
  getToken: () => authSource.getAccessToken(),
  diagram: () => {
    const d = session.getState().diagram;
    return d ? { id: d.id, version: d.version } : null;
  },
  watchVersion: (listener) => {
    let last = session.getState().diagram?.version;
    return session.subscribe((s) => {
      const version = s.diagram?.version;
      if (version !== undefined && version !== last) {
        last = version;
        listener(version);
      }
    });
  },
  resync: async () => {
    await session.flush().catch(() => undefined);
    await session.refreshIfIdle();
    const id = session.getState().diagram?.id;
    if (id) await syncConversation(id);
  },
  onResult: applyResult,
  update: (patch) => {
    if (patch.working) stopSpeaking(); // the user spoke again: stop talking over them
    useVoiceStore.setState(patch);
  },
});
