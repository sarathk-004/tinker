import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { AudioRecorder } from '../ai/audioRecorder';
import { GeminiLiveClient } from '../ai/geminiLive';

interface VoiceControlProps {
  apiKey: string;
  onOpenSettings: () => void;
}

export const VoiceControl: React.FC<VoiceControlProps> = ({ apiKey: propApiKey, onOpenSettings }) => {
  const [liveState, setLiveState] = useState<'idle' | 'connecting' | 'listening' | 'processing' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [voiceMode, setVoiceMode] = useState<'speech_nlu' | 'gemini_live'>('speech_nlu');
  const recorderRef = useRef<AudioRecorder | null>(null);
  const clientRef = useRef<GeminiLiveClient | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const getActiveKey = () => {
    return (
      (typeof localStorage !== 'undefined' ? localStorage.getItem('tinker_gemini_api_key') : null) ||
      propApiKey ||
      import.meta.env.VITE_GEMINI_API_KEY ||
      ''
    );
  };

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (recorderRef.current) recorderRef.current.stop();
      if (clientRef.current) clientRef.current.disconnect();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
      }
    };
  }, []);

  const handleToggleVoice = async () => {
    const activeKey = getActiveKey();

    if (liveState === 'idle' || liveState === 'error') {
      // Check if browser SpeechRecognition is available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (voiceMode === 'speech_nlu' && SpeechRecognition) {
        try {
          setLiveState('listening');
          setStatusText('Listening for architecture command...');

          const recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recognition.onresult = (event: any) => {
            const current = event.resultIndex;
            const transcript = event.results[current][0].transcript;
            setStatusText(`Heard: "${transcript}"`);

            if (event.results[current].isFinal) {
              setLiveState('processing');
              setStatusText(`Processing: "${transcript}"...`);
              
              // Import orchestrator dynamically
              import('../ai/orchestrator').then(async ({ processArchitectureInstruction }) => {
                try {
                  const result = await processArchitectureInstruction(transcript, activeKey);
                  if (result.success) {
                    setStatusText(result.actionsExecuted.join(' • ') || 'Diagram updated');
                  } else {
                    setStatusText(result.error || 'Could not understand command');
                  }
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  setStatusText(`Error: ${msg}`);
                } finally {
                  setTimeout(() => {
                    setLiveState('idle');
                    setStatusText('');
                  }, 2500);
                }
              });
            }
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recognition.onerror = (event: any) => {
            console.warn('SpeechRecognition error:', event.error);
            if (event.error !== 'no-speech') {
              setLiveState('error');
              setStatusText(`Voice error: ${event.error}`);
              setTimeout(() => {
                setLiveState('idle');
                setStatusText('');
              }, 3000);
            } else {
              setLiveState('idle');
              setStatusText('');
            }
          };

          recognition.onend = () => {
            setLiveState((curr) => {
              if (curr === 'listening') {
                setStatusText('');
                return 'idle';
              }
              return curr;
            });
          };

          recognitionRef.current = recognition;
          recognition.start();
        } catch (err) {
          console.error('Speech recognition start failed:', err);
          setLiveState('error');
          setStatusText('Could not access microphone');
          setTimeout(() => setLiveState('idle'), 3000);
        }
      } else {
        // Gemini Live Multimodal WebSocket Mode
        if (!activeKey || activeKey.length < 10) {
          onOpenSettings();
          return;
        }

        try {
          setLiveState('connecting');
          setStatusText('Connecting to Gemini Live...');

          clientRef.current = new GeminiLiveClient(
            activeKey,
            (state) => {
              setLiveState(state);
            },
            (msg) => {
              setStatusText(msg);
            }
          );
          clientRef.current.connect();

          recorderRef.current = new AudioRecorder();
          await recorderRef.current.start((base64Pcm) => {
            if (clientRef.current) {
              clientRef.current.sendAudioChunk(base64Pcm);
            }
          });
        } catch (err) {
          console.error('Failed to start Gemini Live voice mode:', err);
          setLiveState('error');
          setStatusText('Mic access denied or WebSocket failure');
          setTimeout(() => setLiveState('idle'), 3000);
        }
      }
    } else {
      // User clicked to stop
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
        recognitionRef.current = null;
      }
      if (recorderRef.current) {
        recorderRef.current.stop();
        recorderRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      setLiveState('idle');
      setStatusText('');
    }
  };

  // Ring animation class based on state
  const ringClass = {
    idle: 'border-slate-700 hover:border-slate-600 bg-[#11141c]',
    connecting: 'border-amber-500/50 bg-amber-500/10 animate-pulse',
    listening: 'border-rose-500 bg-rose-500/20 shadow-[0_0_20px_rgba(225,29,72,0.4)]',
    processing: 'border-amber-400 bg-amber-400/20 shadow-[0_0_15px_rgba(251,191,36,0.3)]',
    error: 'border-red-500 bg-red-500/20',
  }[liveState];

  return (
    <div className="flex flex-col items-center justify-center pointer-events-auto gap-1">
      <div className="relative flex items-center justify-center">
        <button
          onClick={handleToggleVoice}
          title={
            liveState === 'idle'
              ? `Start Voice (${voiceMode === 'speech_nlu' ? 'Speech NLU' : 'Gemini Live WS'})`
              : 'Stop Voice'
          }
          className={`relative flex items-center justify-center w-14 h-14 rounded-full border-2 transition-all duration-300 ${ringClass}`}
        >
          {liveState === 'connecting' || liveState === 'processing' ? (
            <Loader2 className={`w-6 h-6 animate-spin ${liveState === 'processing' ? 'text-amber-400' : 'text-slate-400'}`} />
          ) : liveState === 'listening' ? (
            <Mic className="w-6 h-6 text-rose-500 animate-pulse" />
          ) : (
            <MicOff className="w-6 h-6 text-slate-500" />
          )}
        </button>

        {statusText && (
          <div className="absolute -top-9 px-3 py-1 text-[11px] font-medium bg-slate-900/95 text-slate-200 rounded-full border border-slate-700/80 whitespace-nowrap animate-fade-in shadow-xl backdrop-blur-md max-w-xs truncate">
            {statusText}
          </div>
        )}
      </div>

      {liveState === 'idle' && (
        <button
          onClick={() => setVoiceMode((m) => (m === 'speech_nlu' ? 'gemini_live' : 'speech_nlu'))}
          className="text-[9px] uppercase tracking-wider text-slate-500 hover:text-amber-400 transition-colors font-mono"
          title="Click to switch voice engine"
        >
          {voiceMode === 'speech_nlu' ? 'Mode: Speech NLU' : 'Mode: Gemini Live WS'}
        </button>
      )}
    </div>
  );
};
