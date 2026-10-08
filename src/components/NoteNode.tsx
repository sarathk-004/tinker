import React, { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { noteActions } from '../diagram/notes';
import { useUi } from '../shell/uiStore';

export interface NoteNodeData extends Record<string, unknown> {
  noteId: string;
  text: string;
}

/** Free text on the canvas. Double-click to edit; it is saved with the diagram but is not a component and has no connections. */
export const NoteNode: React.FC<NodeProps> = memo(({ data, selected }) => {
  const { noteId, text } = data as NoteNodeData;
  const editing = useUi((s) => s.editingNoteId === noteId);
  const [draft, setDraft] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(text);
      setTimeout(() => box.current?.focus(), 0);
    }
  }, [editing, text]);

  const finish = (save: boolean) => {
    useUi.getState().set({ editingNoteId: null });
    if (!save) {
      if (!text.trim()) noteActions.remove([noteId]); // a note that was never written is not kept
      return;
    }
    if (!draft.trim()) noteActions.remove([noteId]);
    else if (draft !== text) noteActions.update(noteId, { text: draft });
  };

  return (
    <div
      onDoubleClick={() => useUi.getState().set({ editingNoteId: noteId })}
      className={`h-full min-h-[44px] rounded-lg border px-3 py-2 text-[14px] leading-[1.5] text-[#26251e] bg-[#fdf8e6] ${selected ? 'border-[#f54e00]' : 'border-[#ecdfae]'} shadow-[0_1px_2px_rgba(38,37,30,0.04)]`}
    >
      <NodeResizer
        minWidth={120}
        maxWidth={800}
        minHeight={44}
        isVisible={selected && !editing}
        lineClassName="!border-[#f54e00]/40"
        handleClassName="!w-2 !h-2 !bg-white !border !border-[#f54e00]"
        onResizeEnd={(_e, p) => noteActions.update(noteId, { width: Math.round(p.width), x: Math.round(p.x), y: Math.round(p.y) })}
      />
      {editing ? (
        <textarea
          ref={box}
          value={draft}
          maxLength={2000}
          aria-label="Note text"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              finish(false);
            }
            e.stopPropagation(); // typing must not trigger canvas shortcuts such as Delete
          }}
          className="nodrag nowheel block w-full h-full min-h-[28px] resize-none bg-transparent outline-none"
          placeholder="Type a note…"
        />
      ) : (
        <div className="whitespace-pre-wrap break-words">{text || <span className="text-[#a09c92]">Empty note</span>}</div>
      )}
    </div>
  );
});
NoteNode.displayName = 'NoteNode';
