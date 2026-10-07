import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Command, Link2, Loader2, MessageCircleQuestion, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { submitAiAsk, submitAiCommand } from '../ai/aiCommands';
import { looksLikeQuestion } from '../ai/questions';
import { useConversationStore } from '../ai/conversationStore';
import { useDiagramStore } from '../diagram/store';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { voice, useVoiceStore } from '../voice/voice';
import { effectiveVoice, useSpeechSettings } from '../voice/speech';

const HOLD_MS = 450;

/** What the allowance readout says. Plain commands are free, so only model requests count. */
export function allowanceText(quota: { ai: { used: number; limit: number } } | null): { text: string; low: boolean; out: boolean } | null {
  if (!quota || quota.ai.limit === 0) return null;
  const left = Math.max(0, quota.ai.limit - quota.ai.used);
  return { text: left === 0 ? 'No AI requests left today' : `${left} of ${quota.ai.limit} AI requests left today`, low: left > 0 && left <= Math.ceil(quota.ai.limit * 0.2), out: left === 0 };
}

export const Composer: React.FC = () => {
  const aiAvailable = useWorkspaceStore((s) => s.features.aiCommands);
  const modelAvailable = useWorkspaceStore((s) => s.features.aiModel);
  const voiceAvailable = useWorkspaceStore((s) => s.features.voice);
  const keySource = useWorkspaceStore((s) => s.features.aiKey.source);
  const keyMode = useWorkspaceStore((s) => s.features.aiKey.mode);
  const quota = useWorkspaceStore((s) => s.quota);
  const voiceStatus = useVoiceStore((s) => s.status);
  const heard = useVoiceStore((s) => s.transcript);
  const working = useVoiceStore((s) => s.working);
  const voiceError = useVoiceStore((s) => s.error);
  const voiceInfo = useVoiceStore((s) => s.info);
  const pending = useConversationStore((s) => s.pending);
  const draft = useConversationStore((s) => s.draft);
  const diagram = useDiagramStore((s) => s.doc.diagram);
  const nodeCount = useDiagramStore((s) => s.nodes.length);
  const blocked = useDiagramStore((s) => s.doc.status === 'conflict' || s.doc.status === 'blocked');
  const savedVoice = useSpeechSettings((s) => s.saved);
  const serverCanSpeak = useSpeechSettings((s) => s.serverCanSpeak);
  const replyVoice = effectiveVoice(savedVoice, serverCanSpeak);

  const [input, setInput] = useState('');
  const [askMode, setAskMode] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const heldSince = useRef(0);

  // Suggestion chips and the "put this in the box" buttons fill the box; the person decides whether to send.
  useEffect(() => {
    if (draft) {
      setInput(draft);
      useConversationStore.getState().setDraft('');
      box.current?.focus();
    }
  }, [draft]);

  // Grow with the text, up to about six lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [input]);

  const disabled = !aiAvailable || !diagram || blocked;
  const allowance = allowanceText(quota);

  const send = async () => {
    const text = input.trim();
    if (disabled || pending || !text) return;
    const ok = askMode || looksLikeQuestion(text) ? await submitAiAsk(text) : await submitAiCommand(text);
    if (ok) setInput((current) => (current.trim() === text ? '' : current)); // keep what the person typed meanwhile
    void useWorkspaceStore.getState().refreshQuota();
  };

  // Push to talk: hold the button and release to send; a quick tap switches listening on until the next tap.
  const press = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!voiceAvailable || disabled) return;
    if (voiceStatus === 'listening' || voiceStatus === 'connecting') {
      voice.stop();
      heldSince.current = 0;
      return;
    }
    heldSince.current = Date.now();
    void voice.start();
  };
  const release = () => {
    if (heldSince.current && Date.now() - heldSince.current > HOLD_MS) voice.stop();
    heldSince.current = 0;
  };

  const listening = voiceStatus === 'listening';
  const placeholder = !aiAvailable
    ? 'Typed commands are not available right now. Manual editing works as usual.'
    : keyMode !== 'server' && keySource === 'NONE'
    ? 'Plain commands work. Add your own AI key for free-form requests…'
    : askMode
    ? 'Ask about the diagram, e.g. “What happens if Orders goes down?”'
    : 'Ask for a change, or describe your system…';

  return (
    <div className="flex-shrink-0 border-t border-[#e6e5e0] bg-white px-4 pt-3 pb-3">
      {(voiceStatus !== 'idle' || voiceError || voiceInfo || working) && (
        <div role="status" aria-live="polite" className={`mb-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] bg-white ${voiceError ? 'border-[#cf2d56]/40 text-[#7a1530]' : 'border-[#e6e5e0] text-[#26251e]'}`}>
          {voiceError ? (
            voiceError
          ) : working ? (
            <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Doing: {working}</span>
          ) : voiceStatus === 'connecting' ? (
            'Starting voice…'
          ) : heard ? (
            <span className="italic">“{heard}”</span>
          ) : listening ? (
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#f54e00] animate-pulse" /> Listening… say a command or ask a question.</span>
          ) : (
            voiceInfo
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 mb-2 text-[12px] text-[#807d72]">
        <Link2 className="w-3.5 h-3.5" />
        <span className="truncate">{diagram ? `Using this diagram · ${nodeCount} component${nodeCount === 1 ? '' : 's'}` : 'No diagram open'}</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        aria-disabled={disabled}
        className={`rounded-2xl bg-[#fafaf7] border border-[#e6e5e0] focus-within:bg-white transition-colors focus-within:border-[#26251e] ${disabled ? 'opacity-80' : 'hover:border-[#cfcdc4]'}`}
      >
        <textarea
          ref={box}
          rows={2}
          value={input}
          maxLength={2000}
          disabled={disabled || pending}
          placeholder={placeholder}
          aria-label="Message to Tinker"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-[1.5] text-[#26251e] placeholder-[#a09c92] outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
          <button
            type="button"
            onClick={() => setAskMode((m) => !m)}
            disabled={disabled}
            aria-pressed={askMode}
            title={askMode ? 'Ask mode: questions only, the diagram is never changed. Click to switch back to changes.' : 'Change mode. Click for Ask mode (questions only). Anything ending in ? is a question anyway.'}
            className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium transition-colors ${askMode ? 'bg-[#26251e] border-[#26251e] text-white' : 'bg-[#fafaf7] border-[#e6e5e0] text-[#5a5852] hover:border-[#cfcdc4]'}`}
          >
            {askMode ? <MessageCircleQuestion className="w-3.5 h-3.5" /> : <Command className="w-3.5 h-3.5" />}
            {askMode ? 'Ask' : 'Edit'}
          </button>

          <button
            type="button"
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void voice.toggle();
              }
            }}
            disabled={!voiceAvailable || disabled}
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Hold to talk'}
            title={!voiceAvailable ? 'Voice is not available on this server' : 'Hold to talk, release to send. A quick tap keeps listening until you tap again.'}
            className={`flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-lg text-[12.5px] font-medium select-none touch-none transition-colors ${
              listening ? 'bg-[#f54e00] text-white' : voiceAvailable && !disabled ? 'bg-[#fdebe3] text-[#d04200] hover:bg-[#fbdccd]' : 'bg-[#efeee8] text-[#a09c92] cursor-not-allowed'
            }`}
          >
            {voiceStatus === 'connecting' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : voiceAvailable ? <Mic className={`w-3.5 h-3.5 ${listening ? 'animate-pulse' : ''}`} /> : <MicOff className="w-3.5 h-3.5" />}
            {listening ? 'Listening…' : 'Hold to talk'}
          </button>

          <span className="flex-1" />

          {voiceAvailable && (
            <span title={`Spoken replies: ${replyVoice === 'gemini' ? 'Gemini voice' : replyVoice === 'browser' ? 'browser voice' : 'off'} (change in the ⋯ menu)`} className="text-[#807d72]">
              {replyVoice === 'off' ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </span>
          )}

          <button
            type="submit"
            disabled={disabled || pending || !input.trim()}
            aria-label={askMode ? 'Ask' : 'Send'}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#f54e00] hover:bg-[#d04200] disabled:bg-[#e6e5e0] disabled:text-[#a09c92] disabled:cursor-not-allowed text-white transition-colors"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-[18px] h-[18px]" />}
          </button>
        </div>
      </form>

      <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11.5px] text-[#807d72]">
        <span className="flex items-center gap-2 min-w-0">
          <span title={modelAvailable ? 'Free-form requests use the Gemini model on the server' : 'No AI model on this server: plain commands only'} className="font-medium text-[#5a5852]">{modelAvailable ? 'Gemini' : 'Plain commands'}</span>
          {allowance && (
            <span title="Plain commands are free and never counted. Resets at 00:00 UTC." className={allowance.out ? 'text-[#cf2d56] font-medium' : allowance.low ? 'text-[#b25a00]' : ''}>
              · {allowance.text}
            </span>
          )}
        </span>
        <span className="whitespace-nowrap hidden sm:inline">↵ Send · ⇧ ↵ New line</span>
      </div>
    </div>
  );
};

