import React, { useMemo, useState } from 'react';
import { GripVertical, Search } from 'lucide-react';
import { AWSIcon } from '../components/icons/AWSIcons';
import { useDiagramStore } from '../diagram/store';
import { COMPONENT_DRAG_TYPE, useAddComponent } from './addComponent';
import { PALETTE, type QuickComponent } from './palette';
import { MONO_LABEL } from './Popover';
import { scoreText } from './search';

/** The "Components" tab: every component Tinker knows, to drag onto the canvas or click to add. */
export const ComponentsPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const add = useAddComponent();
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);

  const groups = useMemo(() => {
    const q = query.trim();
    const matches = PALETTE.filter((c) => !q || Math.max(scoreText(c.label, q), scoreText(c.subType ?? '', q), scoreText(c.category, q)) > 0);
    const categories = [...new Set(matches.map((c) => c.category))];
    return categories.map((category) => ({ category, items: matches.filter((c) => c.category === category) }));
  }, [query]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <label className="flex items-center gap-2 h-9 px-3 rounded-lg border border-[#e6e5e0] bg-[#fafaf7] focus-within:bg-white focus-within:border-[#26251e]">
          <Search className="w-4 h-4 text-[#807d72]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search components" aria-label="Search components" className="flex-1 bg-transparent text-[13.5px] outline-none placeholder-[#a09c92]" />
        </label>
        <p className="mt-2 text-[12px] text-[#807d72]">Drag a component onto the canvas, or click it to add it to the middle of the view.</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {groups.length === 0 && <p className="py-8 text-center text-[13px] text-[#807d72]">No component matches “{query}”.</p>}
        {groups.map(({ category, items }) => (
          <section key={category} className="mb-4">
            <h3 className={`mb-1.5 ${MONO_LABEL}`}>{category}</h3>
            <div className="grid grid-cols-1 gap-1.5">
              {items.map((c: QuickComponent) => (
                <button
                  key={c.label}
                  draggable={hasDiagram}
                  disabled={!hasDiagram}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(COMPONENT_DRAG_TYPE, c.label);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => void add(c)}
                  title={hasDiagram ? `Add ${c.label}` : 'Open a diagram first'}
                  className="group flex items-center gap-3 px-2.5 py-2 rounded-xl border border-[#e6e5e0] bg-white hover:border-[#cfcdc4] hover:shadow-[0_2px_10px_rgba(38,37,30,0.05)] text-left cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="w-9 h-9 rounded-lg bg-[#fafaf7] border border-[#e6e5e0] flex items-center justify-center flex-shrink-0"><AWSIcon name={c.awsIcon} type={c.type} size={22} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-[#26251e] truncate">{c.label}</span>
                    <span className="block text-[11.5px] text-[#807d72] truncate">{c.subType}</span>
                  </span>
                  <GripVertical className="w-4 h-4 text-[#cfcdc4] group-hover:text-[#807d72] flex-shrink-0" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
