import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Command, Loader2, MessageCircleQuestion, Mic, MicOff, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { submitAiAsk, submitAiCommand } from '../ai/aiCommands';
import { looksLikeQuestion } from '../ai/questions';
import { useConversationStore } from '../ai/conversationStore';
import { useDiagramStore } from '../diagram/store';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { voice, useVoiceStore } from '../voice/voice';
import { effectiveVoice, stopSpeaking, useSpeechSettings, type ReplyVoice } from '../voice/speech';

const EXAMPLES = ['Put Redis between Orders and PostgreSQL', 'Add an API Gateway', 'What happens if Orders goes down?'];

/**
 * Typed commands. Text goes to the server, which applies it as one atomic edit (or asks a question); nothing here edits
 * the diagram directly. Voice returns later (I7). Disabled with an explanation when the server has no AI configured.
 */
export const CommandBar: React.FC = () => {
  const aiAvailable = useWorkspaceStore((s) => s.features.aiCommands);
  const modelAvailable = useWorkspaceStore((s) => s.features.aiModel);
  const voiceAvailable = useWorkspaceStore((s) => s.features.voice);
  const voiceStatus = useVoiceStore((s) => s.status);
  const heard = useVoiceStore((s) => s.transcript);
  const working = useVoiceStore((s) => s.working);
  const voiceError = useVoiceStore((s) => s.error);
  const voiceInfo = useVoiceStore((s) => s.info);
  const pending = useConversationStore((s) => s.pending);
  const draft = useConversationStore((s) => s.draft);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const blocked = useDiagramStore((s) => s.doc.status === 'conflict' || s.doc.status === 'blocked');
  const [input, setInput] = useState('');
  const [askMode, setAskMode] = useState(false);
  const [voiceMenu, setVoiceMenu] = useState(false);
  const savedVoice = useSpeechSettings((s) => s.saved);
  const speaking = useSpeechSettings((s) => s.speaking);
  const serverCanSpeak = useSpeechSettings((s) => s.serverCanSpeak);
  const replyVoice = effectiveVoice(savedVoice, serverCanSpeak);
  const inputRef = useRef<HTMLInputElement>(null);

  // Suggestion chips in the conversation fill the bar; the user decides whether to send.
  useEffect(() => {
    if (draft) {
      setInput(draft);
      useConversationStore.getState().setDraft('');
      inputRef.current?.focus();
    }
  }, [draft]);

  const disabled = !aiAvailable || !hasDiagram || blocked;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || pending || !input.trim()) return;
    const text = input;
    // Questions (ending in "?") or the Ask switch go to read-only advice; everything else is an edit command.
    const ok = askMode || looksLikeQuestion(text) ? await submitAiAsk(text) : await submitAiCommand(text);
    if (ok) setInput((current) => (current === text ? '' : current)); // keep what the user typed meanwhile
  };

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4 select-none flex flex-col gap-2">
      {aiAvailable && !pending && input === '' && hasDiagram && (
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#5a5852] overflow-x-auto">
          <span className="flex items-center gap-1 font-mono text-[#807d72] flex-shrink-0">
            <Sparkles className="w-3 h-3 text-[#f54e00]" /> Try:
          </span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setInput(ex)} className="px-2 py-1 rounded-md bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] whitespace-nowrap">
              {ex}
            </button>
          ))}
        </div>
      )}

      {(voiceStatus !== 'idle' || voiceError || voiceInfo || working) && (
        <div role="status" aria-live="polite" className={`px-3 py-1.5 rounded-md border text-[12px] bg-white ${voiceError ? 'border-[#cf2d56]/40 text-[#7a1530]' : 'border-[#e6e5e0] text-[#26251e]'}`}>
          {voiceError ? (
            voiceError
          ) : working ? (
            <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Doing: {working}</span>
          ) : voiceStatus === 'connecting' ? (
            'Starting voice…'
          ) : heard ? (
            <span className="italic">{heard}</span>
          ) : voiceStatus === 'listening' ? (
            'Listening… say a command, or ask a question.'
          ) : (
            voiceInfo
          )}
        </div>
      )}

      <form
        onSubmit={submit}
        aria-disabled={disabled}
        className={`w-full flex items-center gap-2 p-1.5 pl-3.5 rounded-md bg-white border border-[#e6e5e0] transition-all focus-within:border-[#26251e] ${disabled ? 'opacity-80' : 'hover:border-[#cfcdc4]'}`}
      >
        <button
          type="button"
          onClick={() => setAskMode((m) => !m)}
          disabled={disabled}
          aria-pressed={askMode}
          title={askMode ? 'Ask mode: questions only, the diagram is never changed. Click to switch back to commands.' : 'Edit mode. Click to switch to Ask mode (questions only). Anything ending in ? is treated as a question.'}
          className={`flex items-center gap-1 px-1.5 py-1 rounded-md border text-[11px] font-mono transition-colors ${askMode ? 'bg-[#26251e] border-[#26251e] text-white' : 'bg-[#fafaf7] border-[#e6e5e0] text-[#5a5852] hover:border-[#cfcdc4]'}`}
        >
          {askMode ? <MessageCircleQuestion className="w-3.5 h-3.5" /> : <Command className="w-3.5 h-3.5" />}
          {askMode ? 'Ask' : 'Edit'}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || pending}
          placeholder={
            !aiAvailable
              ? 'Typed commands are not available right now. Manual editing works as usual.'
              : modelAvailable
              ? askMode
                ? 'Ask about the diagram, e.g. "What happens if Orders goes down?"…'
                : 'Type a command, or ask a question ending in ?, e.g. "Put Redis between Orders and PostgreSQL"…'
              : 'Type a simple command, e.g. "Put Redis between Orders and PostgreSQL" (free-form AI needs a key on the server)…'
          }
          aria-label="Command"
          className="flex-1 bg-transparent text-sm text-[#26251e] placeholder-[#807d72] focus:outline-none disabled:cursor-not-allowed font-sans"
        />
        <button
          type="button"
          onClick={() => void voice.toggle()}
          disabled={!voiceAvailable || disabled}
          aria-pressed={voiceStatus === 'listening'}
          aria-label={voiceStatus === 'listening' ? 'Stop listening' : 'Start voice'}
          title={!voiceAvailable ? 'Voice is not available on this server' : voiceStatus === 'listening' ? 'Listening. Click to stop.' : 'Speak a command or question'}
          className={`p-1.5 rounded-md border transition-colors ${
            voiceStatus === 'listening'
              ? 'bg-[#f54e00] border-[#f54e00] text-white animate-pulse'
              : voiceStatus === 'connecting'
              ? 'bg-[#fafaf7] border-[#e6e5e0] text-[#807d72]'
              : voiceAvailable && !disabled
              ? 'bg-[#fafaf7] border-[#e6e5e0] text-[#26251e] hover:border-[#cfcdc4]'
              : 'bg-[#fafaf7] border-[#e6e5e0] text-[#a09c92] cursor-not-allowed'
          }`}
        >
          {voiceStatus === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> : voiceAvailable ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>
        {voiceAvailable && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setVoiceMenu((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={voiceMenu}
              aria-label="Spoken replies"
              title={`Spoken replies: ${replyVoice === 'gemini' ? 'Gemini voice' : replyVoice === 'browser' ? 'browser voice' : 'off'}`}
              className={`p-1.5 rounded-md border transition-colors ${speaking ? 'bg-[#26251e] border-[#26251e] text-white' : 'bg-[#fafaf7] border-[#e6e5e0] text-[#26251e] hover:border-[#cfcdc4]'}`}
            >
              {replyVoice === 'off' ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            {voiceMenu && (
              <div role="menu" className="absolute bottom-full right-0 mb-2 w-64 rounded-md border border-[#e6e5e0] bg-white shadow-lg p-1 text-[12px] text-[#26251e] z-40">
                <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#807d72]">Read replies aloud</div>
                {([
                  ['gemini', 'Gemini voice', 'Natural voice. Uses your Gemini quota.', serverCanSpeak],
                  ['browser', 'Browser voice', 'Free, built into your browser. More robotic.', true],
                  ['off', 'Off', 'Replies stay text only.', true],
                ] as Array<[ReplyVoice, string, string, boolean]>).map(([value, label, hint, enabled]) => (
                  <button
                    key={value}
                    role="menuitemradio"
                    aria-checked={replyVoice === value}
                    disabled={!enabled}
                    onClick={() => {
                      useSpeechSettings.getState().choose(value);
                      if (value === 'off') stopSpeaking();
                      setVoiceMenu(false);
                    }}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded text-left hover:bg-[#fafaf7] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="w-3.5 pt-0.5">{replyVoice === value && <Check className="w-3.5 h-3.5 text-[#f54e00]" />}</span>
                    <span>
                      <span className="block font-medium">{label}</span>
                      <span className="block text-[11px] text-[#807d72]">{enabled ? hint : 'Not available on this server.'}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={disabled || pending || !input.trim()}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-[#f54e00] hover:bg-[#d04200] disabled:bg-[#e6e5e0] disabled:text-[#a09c92] disabled:cursor-not-allowed text-white transition-all"
          aria-label={askMode ? 'Ask' : 'Send command'}
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
};
