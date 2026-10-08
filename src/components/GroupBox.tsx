import React, { memo, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Layers, X } from 'lucide-react';
import { groupJoin, groupParent } from '../contracts';
import { useDiagramStore } from '../diagram/store';
import { useUi } from '../shell/uiStore';

export interface GroupBoxData extends Record<string, unknown> {
  path: string;
  label: string;
  count: number;
}

/**
 * A dotted boundary around a group of components, with its name on top. The box itself lets clicks through to the canvas; only the name
 * strip can be grabbed (drag it to move the whole group, or into another group), double-clicked (rename) or ungrouped.
 */
export const GroupBox: React.FC<NodeProps> = memo(({ data, selected }) => {
  const { path, label, count } = data as GroupBoxData;
  const editing = useUi((s) => s.editingGroupPath === path);
  const [draft, setDraft] = useState(label);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(label);
      setTimeout(() => input.current?.select(), 0);
    }
  }, [editing, label]);

  const finish = (save: boolean) => {
    useUi.getState().set({ editingGroupPath: null });
    const typed = draft.trim();
    if (!save || !typed || typed === label) return;
    // Typing "A / B" nests it; the parent of the group stays in front of whatever was typed.
    void useDiagramStore.getState().renameGroup(path, groupJoin(groupParent(path), typed));
  };

  return (
    <div className={`w-full h-full rounded-2xl border-[1.5px] border-dashed pointer-events-none ${selected ? 'border-[#f54e00] bg-[#f54e00]/[0.03]' : 'border-[#cfcdc4] bg-white/20'}`}>
      <div
        onDoubleClick={() => useUi.getState().set({ editingGroupPath: path })}
        title={`${path}. Drag to move the group, double-click to rename`}
        className="group-handle pointer-events-auto absolute left-3 top-2 max-w-[calc(100%-1.5rem)] flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-md bg-[#f7f7f4] cursor-grab active:cursor-grabbing select-none"
      >
        <Layers className="w-3.5 h-3.5 text-[#807d72] flex-shrink-0" />
        {editing ? (
          <input
            ref={input}
            autoFocus
            value={draft}
            maxLength={120}
            aria-label="Group name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish(true);
              if (e.key === 'Escape') finish(false);
              e.stopPropagation();
            }}
            className="nodrag w-40 bg-white border border-[#26251e] rounded px-1 text-[12.5px] font-medium text-[#26251e] outline-none"
          />
        ) : (
          <span className="text-[12.5px] font-medium text-[#5a5852] truncate">{label}</span>
        )}
        {!editing && <span className="font-mono text-[10px] text-[#a09c92]">{count}</span>}
        {!editing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void useDiagramStore.getState().ungroup(path);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Ungroup (the components stay)"
            aria-label={`Ungroup ${label}`}
            className="nodrag p-0.5 rounded text-[#a09c92] hover:text-[#cf2d56] hover:bg-[#cf2d56]/10"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
});
GroupBox.displayName = 'GroupBox';
