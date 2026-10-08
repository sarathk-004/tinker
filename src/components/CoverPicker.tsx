import React from 'react';
import type { ProjectCover } from '../contracts';
import { COVER_PRESETS } from '../catalog/covers';
import { PresetArt } from './ProjectCoverArt';

/** Choose a cover: Automatic, (for a project) Plain with the latest drawing, or one of the dithered covers. */
export const CoverPicker: React.FC<{ value: ProjectCover | null; onChange: (next: ProjectCover | null) => void; allowPlain?: boolean; disabled?: boolean }> = ({ value, onChange, allowPlain = false, disabled = false }) => (
  <div role="radiogroup" aria-label="Cover" className="grid grid-cols-5 gap-2">
    {([[null, 'Automatic'], ...(allowPlain ? ([['preview', 'Latest diagram']] as const) : [])] as ReadonlyArray<readonly [ProjectCover | null, string]>).map(([id, label]) => (
      <button key={label} type="button" role="radio" aria-checked={value === id} disabled={disabled} onClick={() => onChange(id)} className={`h-14 rounded-xl text-[11px] leading-tight px-1 ${value === id ? 'ring-2 ring-primary/60 bg-canvas text-ink font-medium' : 'bg-canvas text-body hover:bg-fill'} disabled:opacity-50`}>
        {label}
      </button>
    ))}
    {COVER_PRESETS.map((p) => (
      <button key={p.id} type="button" role="radio" aria-checked={value === p.id} aria-label={p.label} title={p.label} disabled={disabled} onClick={() => onChange(p.id)} className={`h-14 rounded-xl overflow-hidden ${value === p.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''} disabled:opacity-50`}>
        <PresetArt preset={p} className="w-full h-full" />
      </button>
    ))}
  </div>
);
