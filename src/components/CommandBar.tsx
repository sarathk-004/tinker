import React from 'react';
import { ArrowRight, Command, Mic } from 'lucide-react';

/**
 * Typed and voice commands are temporarily off. The prototype called Gemini straight from the browser with a browser-held key;
 * that path was removed in I4. They return through the server in I5 (typed) and I7 (voice), using the same command path as manual edits.
 */
export const CommandBar: React.FC = () => {
  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4 select-none">
      <form
        onSubmit={(e) => e.preventDefault()}
        aria-disabled="true"
        className="w-full flex items-center gap-2 p-1.5 pl-3.5 rounded-md bg-white border border-[#e6e5e0] opacity-80"
      >
        <Command className="w-4 h-4 text-[#807d72]" />
        <input
          type="text"
          disabled
          placeholder="Typed and voice commands are coming back soon. Manual editing works as usual."
          className="flex-1 bg-transparent text-sm text-[#26251e] placeholder-[#807d72] focus:outline-none disabled:cursor-not-allowed font-sans"
        />
        <button type="button" disabled title="Voice returns in a later update" className="p-1.5 rounded-md bg-[#fafaf7] border border-[#e6e5e0] text-[#a09c92] cursor-not-allowed">
          <Mic className="w-4 h-4" />
        </button>
        <button type="submit" disabled className="flex items-center justify-center w-8 h-8 rounded-md bg-[#e6e5e0] text-[#a09c92] cursor-not-allowed">
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
