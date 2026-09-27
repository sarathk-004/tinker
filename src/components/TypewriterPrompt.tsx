import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { processArchitectureInstruction } from '../ai/orchestrator';
import { TinkerLogo } from './TinkerLogo';

interface PromptItem {
  prefix: string;
  highlight: string;
  suffix?: string;
  fullCommand: string;
}

const TYPEWRITER_PROMPTS: PromptItem[] = [
  {
    prefix: 'Try voice or text: ',
    highlight: 'What happens if Auth goes down?',
    fullCommand: 'What happens if Auth goes down?',
  },
  {
    prefix: 'Build system: ',
    highlight: 'Client talks to API Gateway, then Orders and Auth',
    fullCommand: 'Client talks to API Gateway, then to Orders and Auth',
  },
  {
    prefix: 'Optimize cache: ',
    highlight: 'Put Redis between Orders and Postgres DB',
    fullCommand: 'Put Redis between Orders and Postgres',
  },
  {
    prefix: 'Trace flow: ',
    highlight: 'Highlight the payment flow',
    fullCommand: 'Highlight the payment flow',
  },
  {
    prefix: 'Decouple queues: ',
    highlight: 'Add SQS queue between Orders and Payments',
    fullCommand: 'Add SQS queue between Orders and Payments',
  },
];

export const TypewriterPrompt: React.FC = () => {
  const [promptIndex, setPromptIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const currentPrompt = TYPEWRITER_PROMPTS[promptIndex];
  const fullText = `${currentPrompt.prefix} ${currentPrompt.highlight}`;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (isPaused) {
      timer = setTimeout(() => {
        setIsPaused(false);
        setIsDeleting(true);
      }, 2600);
      return () => clearTimeout(timer);
    }

    if (!isDeleting) {
      if (displayedText.length < fullText.length) {
        timer = setTimeout(() => {
          setDisplayedText(fullText.slice(0, displayedText.length + 1));
        }, 38);
      } else {
        setIsPaused(true);
      }
    } else {
      if (displayedText.length > currentPrompt.prefix.length) {
        timer = setTimeout(() => {
          setDisplayedText(fullText.slice(0, displayedText.length - 2));
        }, 18);
      } else {
        setIsDeleting(false);
        setPromptIndex((prev) => (prev + 1) % TYPEWRITER_PROMPTS.length);
      }
    }

    return () => clearTimeout(timer);
  }, [displayedText, isDeleting, isPaused, fullText, currentPrompt.prefix.length]);

  const handleRunCommand = (cmd: string) => {
    processArchitectureInstruction(cmd);
  };

  // Render prefix normal, highlight bolded in Geist Mono
  const renderStyledText = () => {
    const prefixLen = currentPrompt.prefix.length;
    if (displayedText.length <= prefixLen) {
      return <span className="text-[#807d72]">{displayedText}</span>;
    }
    const prefixPart = displayedText.slice(0, prefixLen);
    const highlightPart = displayedText.slice(prefixLen);

    return (
      <>
        <span className="text-[#807d72]">{prefixPart}</span>
        <strong className="text-[#26251e] font-bold font-mono tracking-tight underline decoration-[#f54e00]/40 decoration-1 underline-offset-2">
          {highlightPart}
        </strong>
      </>
    );
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 px-4 select-none">
      <div className="flex flex-col items-center max-w-xl w-full text-center">
        {/* Sleek Terminal Badge in Geist Mono with Tinker Logo */}
        <div className="flex items-center gap-2.5 mb-3 pointer-events-auto">
          <TinkerLogo size={32} className="shadow-xs border border-[#e6e5e0]" />
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#e6e5e0] text-xs font-mono text-[#5a5852] shadow-xs">
            <span className="text-[#26251e] font-semibold">tinker://</span>
            <span>interactive-aws-studio</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
          </div>
        </div>

        {/* Animated Typewriter Card with Geist Mono and Bolded Text */}
        <button
          onClick={() => handleRunCommand(currentPrompt.fullCommand)}
          title="Click to run this command"
          className="pointer-events-auto group px-6 py-4 rounded-lg bg-white border border-[#e6e5e0] hover:border-[#26251e] transition-all flex items-center justify-between gap-4 w-full shadow-xs cursor-pointer text-left"
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <span className="text-[#f54e00] font-mono text-sm font-semibold flex-shrink-0">&gt;</span>
            <div className="font-mono text-sm leading-relaxed truncate">
              {renderStyledText()}
              <span className="inline-block w-2 h-4 ml-1 bg-[#f54e00] animate-pulse align-middle" />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono text-[#807d72] group-hover:text-[#26251e] flex-shrink-0 pl-2 border-l border-[#e6e5e0]">
            <span className="hidden sm:inline">Run</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform text-[#f54e00]" />
          </div>
        </button>

        {/* Quick prompt chips below */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3 pointer-events-auto">
          {TYPEWRITER_PROMPTS.slice(0, 3).map((item, idx) => (
            <button
              key={idx}
              onClick={() => handleRunCommand(item.fullCommand)}
              className="px-2.5 py-1 rounded-md bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] text-[11px] font-mono text-[#5a5852] hover:text-[#26251e] transition-all"
            >
              <Sparkles className="w-3 h-3 text-[#f54e00] inline mr-1" />
              {item.highlight}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
