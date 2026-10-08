import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';
import { useAiKeyStore } from '../ai/aiKey';

const SOURCE_TEXT = {
  USER: 'Your AI requests run on your own key.',
  SERVER: 'Your AI requests run on this app\'s shared key.',
  NONE: 'Free-form AI, voice and spoken replies are off until you add a key. Plain commands, editing, history and advice keep working.',
} as const;

/** Add, replace or remove your own Gemini API key. The key is checked with Google, stored encrypted on the server, and never shown again. */
export const AiKeyDialog: React.FC = () => {
  const { open, status, busy, error, notice, hide, save, remove } = useAiKeyStore();
  const [value, setValue] = useState('');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
    else setValue(''); // never keep what was typed
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);

  if (!open) return null;
  const canSave = value.trim().length >= 20 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-labelledby="ai-key-title" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
      <div className="w-full max-w-md rounded-lg bg-surface border border-line shadow-lg p-5 text-ink">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 id="ai-key-title" className="text-sm font-semibold">Your Gemini API key</h2>
          </div>
          <button onClick={hide} aria-label="Close" className="p-1 rounded text-muted hover:text-ink hover:bg-line">
            <X className="w-4 h-4" />
          </button>
        </div>

        {status && (
          <p className="text-xs text-body mb-3">
            {SOURCE_TEXT[status.source]}
            {status.configured && (
              <>
                {' '}
                <span className="font-mono">…{status.last4}</span> is saved
                {status.verifiedAt ? `, checked ${new Date(status.verifiedAt).toLocaleDateString()}` : ''}.
              </>
            )}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void save(value).then((ok) => ok && setValue(''));
          }}
          className="space-y-2"
        >
          <label htmlFor="ai-key-input" className="block text-xs font-medium">
            {status?.configured ? 'Replace your key' : 'Paste your key'}
          </label>
          <input
            id="ai-key-input"
            ref={field}
            type="password"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            placeholder="AIza…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded-md bg-soft border border-line focus:border-ink focus:bg-surface outline-none"
          />
          <p className="text-[11px] text-muted">
            Create one for free in <span className="font-medium">Google AI Studio</span> (aistudio.google.com, "Get API key"). Usage is billed to your own Google account, not to this app.
          </p>
          <button type="submit" disabled={!canSave} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary hover:bg-primary-hover disabled:bg-line disabled:text-faint text-white text-sm font-medium">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Check and save
          </button>
        </form>

        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
        {notice && <p role="status" className="mt-3 text-xs text-success-ink">{notice}</p>}

        {status?.configured && (
          <button type="button" disabled={busy} onClick={() => void remove()} className="mt-3 text-xs text-body hover:text-danger hover:underline disabled:opacity-50">
            Remove my key from the server
          </button>
        )}

        <div className="mt-4 pt-3 border-t border-line flex items-start gap-2 text-[11px] text-muted">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-success-ink" />
          <p>
            Your key is sent once over an encrypted connection, checked with Google, then stored encrypted on the server. It is used only for your own requests, is never shown again, never written to logs and never kept in your browser. You can remove it any time.
          </p>
        </div>
      </div>
    </div>
  );
};
