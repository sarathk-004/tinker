import React, { useState, useEffect } from 'react';
import { Key, X, Check, ExternalLink, ShieldCheck, Eye, EyeOff, Clipboard, Trash2, Volume2 } from 'lucide-react';
import { AVAILABLE_GEMINI_VOICES, GeminiVoiceName, speakWithGeminiVoice } from '../ai/geminiVoice';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<GeminiVoiceName>('Aoede');
  const [testStatus, setTestStatus] = useState<{ testing: boolean; message?: string; success?: boolean }>({
    testing: false,
  });

  useEffect(() => {
    if (isOpen) {
      const stored =
        localStorage.getItem('tinker_gemini_api_key') ||
        (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '') ||
        '';
      const storedVoice = (localStorage.getItem('tinker_gemini_voice') as GeminiVoiceName) || 'Aoede';
      setApiKey(stored);
      setSelectedVoice(storedVoice);
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

  if (!isOpen) return null;

  const handleTestKey = async () => {
    const key = apiKey.trim();
    if (!key) {
      setTestStatus({ testing: false, success: false, message: 'Please enter an API key first' });
      return;
    }

    setTestStatus({ testing: true, message: 'Testing Gemini API key...' });

    // Try models in order: gemini-3.8-flash -> gemini-2.0-flash -> gemini-1.5-flash
    const candidateModels = ['gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let verifiedModel = '';

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

        if (res.status === 404) {
          continue;
        } else {
          break;
        }
      } catch {
        // continue trying next model
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
            message: '✓ API Key is valid and authorized for Google AI Studio.',
          });
        } else {
          const errData = await listRes.json().catch(() => ({}));
          setTestStatus({
            testing: false,
            success: false,
            message: `Key rejected (${listRes.status}): ${errData.error?.message || 'Check your key'}`,
          });
        }
      } catch (err: unknown) {
        setTestStatus({
          testing: false,
          success: false,
          message: `Network error: ${err instanceof Error ? err.message : 'Failed to reach API'}`,
        });
      }
    }
  };

  const handleTestVoice = async () => {
    localStorage.setItem('tinker_gemini_voice', selectedVoice);
    if (apiKey.trim()) {
      localStorage.setItem('tinker_gemini_api_key', apiKey.trim());
    }
    await speakWithGeminiVoice(`Hello! This is the ${selectedVoice} voice model configured for your architecture advisor.`, selectedVoice);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setApiKey(text.trim());
    } catch {
      // ignore
    }
  };

  const handleSave = () => {
    const key = apiKey.trim();
    if (key) {
      localStorage.setItem('tinker_gemini_api_key', key);
    } else {
      localStorage.removeItem('tinker_gemini_api_key');
    }
    localStorage.setItem('tinker_gemini_voice', selectedVoice);
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
        className="w-full max-w-md bg-[#001e2b] border border-[#1c2d38] rounded-2xl p-6 shadow-2xl relative select-text"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 text-[#a8b3bc] hover:text-white p-1.5 rounded-full hover:bg-[#002636] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-[#00ed64]/15 border border-[#00ed64]/30 flex items-center justify-center text-[#00ed64]">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">AI & Voice Configuration</h3>
            <p className="text-xs text-[#a8b3bc]">Gemini multimodal reasoning & nuanced voice models</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[#a8b3bc] uppercase tracking-wider">
                Gemini API Key
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePaste}
                  className="text-[11px] text-[#a8b3bc] hover:text-[#00ed64] flex items-center gap-1 transition-colors"
                  title="Paste from clipboard"
                >
                  <Clipboard className="w-3 h-3" /> Paste
                </button>
                {apiKey && (
                  <button
                    type="button"
                    onClick={() => setApiKey('')}
                    className="text-[11px] text-[#a8b3bc] hover:text-rose-400 flex items-center gap-1 transition-colors"
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
                className="w-full px-3.5 py-2.5 pr-10 bg-[#002636] border border-[#1c2d38] rounded-xl text-sm text-white placeholder-[#5c6c7a] focus:outline-none focus:border-[#00ed64] font-mono select-text"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 text-[#5c6c7a] hover:text-white transition-colors"
                title={showKey ? 'Hide Key' : 'Show Key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#a8b3bc] mt-2">
              <span>Saved locally in your browser.</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[#00ed64] hover:underline inline-flex items-center gap-1 font-medium"
              >
                Get API Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {testStatus.message && (
              <div
                className={`text-[11px] mt-2 p-2 rounded-xl font-mono leading-relaxed ${
                  testStatus.success
                    ? 'bg-[#00ed64]/10 border border-[#00ed64]/30 text-[#00ed64]'
                    : 'bg-rose-950/60 border border-rose-800 text-rose-300'
                }`}
              >
                {testStatus.message}
              </div>
            )}
          </div>

          {/* Gemini Voice Selection */}
          <div>
            <label className="text-xs font-semibold text-[#a8b3bc] uppercase tracking-wider block mb-2">
              Gemini Voice Model
            </label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_GEMINI_VOICES.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => setSelectedVoice(v.name)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    selectedVoice === v.name
                      ? 'bg-[#00ed64]/15 border-[#00ed64] text-white shadow-sm'
                      : 'bg-[#002636] border-[#1c2d38] text-[#a8b3bc] hover:border-[#243846] hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs">{v.label}</span>
                    <span className="text-[10px] text-[#5c6c7a]">{v.gender}</span>
                  </div>
                  <p className="text-[10px] text-[#5c6c7a] mt-0.5 truncate">{v.style}</p>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleTestVoice}
              className="mt-2 text-[11px] text-[#00ed64] hover:underline flex items-center gap-1.5 font-medium"
            >
              <Volume2 className="w-3.5 h-3.5" /> Preview Selected Voice
            </button>
          </div>

          <div className="p-3 rounded-xl bg-[#002636]/60 border border-[#1c2d38] text-xs text-slate-300 space-y-1.5">
            <div className="flex items-center gap-2 font-medium text-white">
              <ShieldCheck className="w-4 h-4 text-[#00ed64]" />
              <span>Offline / Local Fallback Active</span>
            </div>
            <p className="text-[#a8b3bc] text-[11px] leading-relaxed">
              If an API key is not provided, tinker automatically uses its built-in architecture rule engine for all diagram commands!
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleTestKey}
              disabled={testStatus.testing}
              className="px-3.5 py-2 text-xs font-medium text-[#00ed64] hover:bg-[#00ed64]/10 border border-[#00ed64]/30 rounded-full transition-colors disabled:opacity-50"
            >
              {testStatus.testing ? 'Testing...' : 'Test Connection'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[#a8b3bc] hover:text-white hover:bg-[#002636] rounded-full transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-[#001e2b] bg-[#00ed64] hover:bg-[#00b545] rounded-full transition-colors shadow-lg shadow-[#00ed64]/20"
              >
                {saved ? (
                  <>
                    <Check className="w-4 h-4 text-[#001e2b]" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Save Settings</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
