import React, { useState, useEffect } from 'react';
import { Key, X, Check, ExternalLink, ShieldCheck, Eye, EyeOff, Clipboard, Trash2, Volume2, Sparkles } from 'lucide-react';
import {
  GEMINI_AUDIO_MODELS,
  GEMINI_VOICES,
  getSelectedGeminiAudioModel,
  setSelectedGeminiAudioModel,
  getSelectedGeminiVoice,
  setSelectedGeminiVoice,
  speakWithGeminiVoice,
} from '../ai/geminiVoice';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.8-flash-tts');
  const [selectedVoice, setSelectedVoiceState] = useState<string>('Kore');
  const [testStatus, setTestStatus] = useState<{ testing: boolean; message?: string; success?: boolean }>({
    testing: false,
  });

  useEffect(() => {
    if (isOpen) {
      const stored =
        localStorage.getItem('tinker_gemini_api_key') ||
        localStorage.getItem('tinker_gemini_key') ||
        (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '') ||
        '';
      const storedModel = getSelectedGeminiAudioModel();
      const storedVoice = getSelectedGeminiVoice();
      setApiKey(stored);
      setSelectedModel(storedModel);
      setSelectedVoiceState(storedVoice);
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

    setTestStatus({ testing: true, message: 'Verifying with Google Gemini API...' });

    const candidateModels = [selectedModel, 'gemini-3.8-flash', 'gemini-3.8-flash-tts'];
    let verifiedModel = '';

    for (const model of candidateModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Ping' }] }],
            }),
          }
        );

        if (res.ok) {
          verifiedModel = model;
          break;
        }
      } catch {
        // try next
      }
    }

    if (verifiedModel) {
      setTestStatus({
        testing: false,
        success: true,
        message: `✓ Connected to ${verifiedModel}! Gemini Audio API authorized.`,
      });
    } else {
      setTestStatus({
        testing: false,
        success: false,
        message: 'Could not connect. Please check that your Google AI Studio API key is active.',
      });
    }
  };

  const handleTestVoice = async () => {
    setSelectedGeminiAudioModel(selectedModel);
    setSelectedGeminiVoice(selectedVoice);
    if (apiKey.trim()) {
      localStorage.setItem('tinker_gemini_api_key', apiKey.trim());
      localStorage.setItem('tinker_gemini_key', apiKey.trim());
    }
    await speakWithGeminiVoice(
      `Hello! This is Gemini's natural voice, using the ${selectedVoice} model profile.`,
      selectedModel
    );
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
      localStorage.setItem('tinker_gemini_key', key);
    } else {
      localStorage.removeItem('tinker_gemini_api_key');
      localStorage.removeItem('tinker_gemini_key');
    }
    setSelectedGeminiAudioModel(selectedModel);
    setSelectedGeminiVoice(selectedVoice);
    setSaved(true);
    window.dispatchEvent(new Event('storage'));
    setTimeout(() => {
      onClose();
      setSaved(false);
    }, 400);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#26251e]/40 backdrop-blur-sm animate-fade-in p-4 font-sans select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white border border-[#e6e5e0] rounded-lg p-6 relative select-text max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 text-[#807d72] hover:text-[#26251e] p-1.5 rounded-md hover:bg-[#fafaf7] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-md bg-[#fafaf7] border border-[#e6e5e0] flex items-center justify-center text-[#f54e00]">
            <Key className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-normal tracking-[-0.3px] text-[#26251e]">
              Gemini Voice & API Configuration
            </h3>
            <p className="text-xs text-[#5a5852]">Pure Gemini Multimodal Voice Synthesis</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* API Key Input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-mono font-medium text-[#5a5852] uppercase tracking-wider">
                Google AI Studio Key
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePaste}
                  className="text-[11px] text-[#5a5852] hover:text-[#f54e00] flex items-center gap-1 transition-colors font-mono"
                  title="Paste from clipboard"
                >
                  <Clipboard className="w-3 h-3" /> Paste
                </button>
                {apiKey && (
                  <button
                    type="button"
                    onClick={() => setApiKey('')}
                    className="text-[11px] text-[#5a5852] hover:text-[#cf2d56] flex items-center gap-1 transition-colors font-mono"
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
                className="w-full px-3 py-2 pr-10 bg-white border border-[#e6e5e0] rounded-md text-sm text-[#26251e] placeholder-[#a09c92] focus:outline-none focus:border-[#26251e] font-mono select-text"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 text-[#807d72] hover:text-[#26251e] transition-colors"
                title={showKey ? 'Hide Key' : 'Show Key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#5a5852] mt-2">
              <span>Using API key from .env file or local storage.</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[#f54e00] hover:underline inline-flex items-center gap-1 font-medium"
              >
                Get API Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {testStatus.message && (
              <div
                className={`text-[11px] mt-2 p-2 rounded-md font-mono leading-relaxed ${
                  testStatus.success
                    ? 'bg-[#9fc9a2]/20 border border-[#9fc9a2] text-[#1f8a65]'
                    : 'bg-[#cf2d56]/10 border border-[#cf2d56]/30 text-[#cf2d56]'
                }`}
              >
                {testStatus.message}
              </div>
            )}
          </div>

          {/* Gemini Voice Persona Picker (Kore, Puck, Fenrir) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-mono font-medium text-[#5a5852] uppercase tracking-wider">
                Gemini Voice Tone
              </label>
              <span className="text-[10px] font-mono text-[#807d72]">Soft & Natural</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {GEMINI_VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVoiceState(v.id)}
                  className={`p-2.5 rounded-md border text-left transition-all ${
                    selectedVoice === v.id
                      ? 'bg-[#fafaf7] border-[#26251e] shadow-xs'
                      : 'bg-white border-[#e6e5e0] hover:border-[#cfcdc4]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-xs text-[#26251e] flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-[#f54e00]" />
                      {v.name}
                    </span>
                    {selectedVoice === v.id && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#f54e00]/15 text-[#f54e00]">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#5a5852] mt-0.5">{v.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Gemini Voice Model Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-mono font-medium text-[#5a5852] uppercase tracking-wider">
                Audio Engine Model
              </label>
              <span className="text-[10px] font-mono text-[#807d72]">Gemini Only</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {GEMINI_AUDIO_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id)}
                  className={`p-2 rounded-md border text-left transition-all ${
                    selectedModel === m.id
                      ? 'bg-[#fafaf7] border-[#26251e] shadow-xs'
                      : 'bg-white border-[#e6e5e0] hover:border-[#cfcdc4]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-xs text-[#26251e]">{m.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#e6e5e0] text-[#26251e]">
                      {m.tag}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5a5852] mt-0.5 leading-snug">{m.description}</p>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleTestVoice}
              className="mt-2.5 text-[11px] text-[#f54e00] hover:underline flex items-center gap-1.5 font-medium font-mono"
            >
              <Volume2 className="w-3.5 h-3.5" /> Play Voice Sample ({selectedVoice})
            </button>
          </div>

          {/* Guarantee Box */}
          <div className="p-2.5 rounded-md bg-[#fafaf7] border border-[#e6e5e0] text-xs text-[#5a5852] space-y-1">
            <div className="flex items-center gap-2 font-medium text-[#26251e]">
              <ShieldCheck className="w-4 h-4 text-[#1f8a65]" />
              <span>Strict Gemini Audio Only</span>
            </div>
            <p className="text-[#5a5852] text-[11px] leading-relaxed">
              Robotic OS and Microsoft browser voices are completely disabled. All speech is synthesized directly by Google Gemini's audio models.
            </p>
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[#e6e5e0]">
            <button
              type="button"
              onClick={handleTestKey}
              disabled={testStatus.testing}
              className="px-3 py-1.5 text-xs font-medium text-[#26251e] hover:bg-[#fafaf7] border border-[#e6e5e0] rounded-md transition-colors disabled:opacity-50"
            >
              {testStatus.testing ? 'Testing...' : 'Test Key'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-medium text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-[#f54e00] hover:bg-[#d04200] rounded-md transition-all shadow-xs"
              >
                {saved ? (
                  <>
                    <Check className="w-4 h-4" />
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
