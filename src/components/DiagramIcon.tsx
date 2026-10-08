import React, { useEffect, useMemo, useState } from 'react';
import { Check, MagnifyingGlass, Prohibit } from '@phosphor-icons/react';
import { ICON_COLORS, ICON_GROUPS, joinIcon, parseIcon, searchIcons } from '../catalog/diagramIcons';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { useDismiss } from '../shell/Popover';

/**
 * A diagram's icon: a duotone glyph on a softly tinted tile with a hairline ring. The colour is a theme colour, so the same icon reads
 * well in the light and the dark theme. A diagram that has none shows a quiet default.
 */
export const DiagramIcon: React.FC<{ icon: string | null | undefined; size?: number; className?: string }> = ({ icon, size = 32, className = '' }) => {
  const { entry, color } = parseIcon(icon);
  const { Icon } = entry;
  const glyph = Math.round(size * 0.62);
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        color: `rgb(var(${color.css}))`,
        background: `linear-gradient(160deg, rgb(var(${color.css}) / 0.16), rgb(var(${color.css}) / 0.07))`,
        boxShadow: `inset 0 0 0 1px rgb(var(${color.css}) / 0.20), inset 0 1px 0 rgb(255 255 255 / 0.18)`,
      }}
    >
      <Icon size={glyph} weight="duotone" />
    </span>
  );
};

/** The popup for choosing a diagram's icon and its colour: search, colour row, icons grouped like a shelf. Choosing saves at once. */
export const IconPicker: React.FC<{ diagramId: string; icon: string | null; onClose: () => void; canEdit: boolean }> = ({ diagramId, icon, onClose, canEdit }) => {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useDismiss(true, onClose);
  const { entry, color } = parseIcon(icon);
  const shown = useMemo(() => searchIcons(query), [query]);

  useEffect(() => {
    const t = setTimeout(() => document.getElementById('icon-search')?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const save = async (next: string | null) => {
    setError(null);
    const problem = await useWorkspaceStore.getState().setDiagramIcon(diagramId, next);
    if (problem) setError(problem);
  };

  return (
    <div ref={ref} role="dialog" aria-label="Choose an icon" className="absolute left-0 top-full z-50 mt-2 w-[22rem] rounded-2xl bg-surface lifted p-3 select-none">
      <label className="flex items-center gap-2 h-10 px-3 rounded-xl bg-canvas focus-within:ring-2 focus-within:ring-primary/40">
        <MagnifyingGlass size={16} className="text-muted" aria-hidden />
        <input id="icon-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons" aria-label="Search icons" className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted" />
      </label>

      <div role="radiogroup" aria-label="Icon colour" className="mt-3 flex items-center gap-2">
        {ICON_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={color.id === c.id}
            aria-label={c.label}
            title={c.label}
            disabled={!canEdit}
            onClick={() => void save(joinIcon(entry.name, c.id))}
            className="relative w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: `rgb(var(${c.css}))`, boxShadow: color.id === c.id ? `0 0 0 2px rgb(var(--surface)), 0 0 0 4px rgb(var(${c.css}))` : 'inset 0 0 0 1px rgb(0 0 0 / 0.12)' }}
          >
            {color.id === c.id && <Check size={12} weight="bold" color="white" aria-hidden />}
          </button>
        ))}
        <button type="button" onClick={() => void save(null)} disabled={!canEdit || !icon} className="ml-auto flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] text-body hover:text-ink hover:bg-canvas disabled:opacity-40">
          <Prohibit size={14} aria-hidden /> Remove
        </button>
      </div>

      <div className="mt-3 max-h-64 overflow-y-auto pr-1 -mr-1">
        {shown.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No icon matches “{query}”.</p>}
        {(query.trim() ? [null] : ICON_GROUPS).map((group) => {
          const items = group ? shown.filter((i) => i.group === group) : shown;
          if (items.length === 0) return null;
          return (
            <section key={group ?? 'found'} className="mb-3">
              {group && <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{group}</h3>}
              <div className="grid grid-cols-7 gap-1">
                {items.map((i) => {
                  const chosen = i.name === entry.name && !!icon;
                  const Glyph = i.Icon;
                  return (
                    <button
                      key={i.name}
                      type="button"
                      title={i.label}
                      aria-label={i.label}
                      aria-pressed={chosen}
                      disabled={!canEdit}
                      onClick={() => void save(joinIcon(i.name, color.id))}
                      className={`h-10 rounded-[10px] flex items-center justify-center transition-colors ${chosen ? 'bg-primary-tint ring-1 ring-primary/50' : 'hover:bg-canvas'} disabled:opacity-40`}
                      style={{ color: chosen ? `rgb(var(${color.css}))` : 'rgb(var(--body))' }}
                    >
                      <Glyph size={20} weight="duotone" />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
