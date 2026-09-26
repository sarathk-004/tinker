import React, { useState, useEffect } from 'react';
import { Key, X, Check, ExternalLink, ShieldCheck, Eye, EyeOff, Clipboard, Trash2 } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; message?: string; success?: boolean }>({
    testing: false,
  });

  useEffect(() => {
    if (isOpen) {
      const stored =
        localStorage.getItem('tinker_gemini_api_key') ||
        (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '') ||
        '';
      setApiKey(stored);
      setSaved(false);
      setTestStatus({ testing: false });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // If not open, render nothing
  if (!isOpen) return null;

  const handleTestKey = async () => {
    const key = apiKey.trim();
    if (!key) {
      setTestStatus({ testing: false, success: false, message: 'Please enter an API key first' });
      return;
    }

    setTestStatus({ testing: true, message: 'Testing Gemini API key...' });

    // Try models in order: gemini-2.5-flash -> gemini-1.5-flash -> gemini-2.0-flash
    const candidateModels = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
    let verifiedModel = '';
    let lastError = '';

    for (const model of candidateModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Hello' }] }],
            }),
          }
        );

        if (res.ok) {
          verifiedModel = model;
          break;
        }

        const errText = await res.text();
        if (res.status === 404) {
          // Model deprecated or not found on this tier, try next
          continue;
        } else {
          lastError = `Status ${res.status}: ${errText.slice(0, 100)}`;
          break;
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (verifiedModel) {
      setTestStatus({
        testing: false,
        success: true,
        message: `✓ Connected to ${verifiedModel}! API Key is active.`,
      });
    } else {
      // Fallback: test models list endpoint to see if key itself is authorized
      try {
        const listRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
        );
        if (listRes.ok) {
          setTestStatus({
            testing: false,
            success: true,
            message: '✓ Gemini API Key Verified successfully!',
          });
          return;
        }
      } catch (_) {}

      setTestStatus({
        testing: false,
        success: false,
        message: `Failed: ${lastError || 'Could not verify API key'}`,
      });
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setApiKey(text.trim());
      }
    } catch (_) {
      // Clipboard permission denied or unsupported
    }
  };

  const handleSave = () => {
    const key = apiKey.trim();
    if (key) {
      localStorage.setItem('tinker_gemini_api_key', key);
    } else {
      localStorage.removeItem('tinker_gemini_api_key');
    }
    setSaved(true);
    window.dispatchEvent(new Event('storage'));
    setTimeout(() => {
      onClose();
      setSaved(false);
    }, 400);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#10141e] border border-slate-800 rounded-2xl p-6 shadow-2xl relative select-text"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Gemini AI Configuration</h3>
            <p className="text-xs text-slate-400">Powers natural language & real-time diagramming</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Gemini API Key
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePaste}
                  className="text-[11px] text-slate-400 hover:text-amber-400 flex items-center gap-1 transition-colors"
                  title="Paste from clipboard"
                >
                  <Clipboard className="w-3 h-3" /> Paste
                </button>
                {apiKey && (
                  <button
                    type="button"
                    onClick={() => setApiKey('')}
                    className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                    title="Clear input"
                  >
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
            </div>

            <div className="relative flex items-center">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                autoFocus
                className="w-full px-3.5 py-2.5 pr-10 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono select-text"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 text-slate-400 hover:text-slate-200 transition-colors"
                title={showKey ? 'Hide Key' : 'Show Key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
              <span>Saved locally in your browser.</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 font-medium"
              >
                Get API Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {testStatus.message && (
              <div
                className={`text-[11px] mt-2 p-2 rounded-lg font-mono leading-relaxed ${
                  testStatus.success
                    ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/60 border border-rose-800 text-rose-300'
                }`}
              >
                {testStatus.message}
              </div>
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-300 space-y-1.5">
            <div className="flex items-center gap-2 font-medium text-slate-200">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Offline / Local Fallback Active</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              If an API key is not provided, tinker automatically uses its built-in architecture rule engine for all diagram commands!
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleTestKey}
              disabled={testStatus.testing}
              className="px-3.5 py-2 text-xs font-medium text-amber-400 hover:text-amber-300 border border-amber-500/40 hover:bg-amber-500/10 rounded-xl transition-colors disabled:opacity-50"
            >
              {testStatus.testing ? 'Testing...' : 'Test Connection'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors shadow-lg shadow-amber-500/20"
              >
                {saved ? (
                  <>
                    <Check className="w-4 h-4 text-slate-950" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Save Key</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
