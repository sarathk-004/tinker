import React, { useEffect, useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { LIMITS, type ProjectCover, type ProjectSummary } from '../contracts';
import { CoverPicker } from './CoverPicker';
import { useWorkspaceStore } from '../workspace/workspaceStore';

const FIELD = 'w-full px-3 rounded-lg border border-line bg-canvas text-[13.5px] text-ink placeholder:text-muted focus:outline-none focus:border-primary';

/** Make a project, or change one (name, description) or delete it. Deleting needs a second click, and takes the project's diagrams with it. */
export const ProjectDialog: React.FC<{ project?: ProjectSummary; onClose: () => void; onDeleted?: () => void; canDelete?: boolean }> = ({ project, onClose, onDeleted, canDelete = false }) => {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cover, setCover] = useState<ProjectCover | null>(project?.cover ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const store = useWorkspaceStore.getState();
    const problem = project ? await store.updateProject(project.id, { name: name.trim(), description: description.trim() || null, cover }) : await store.createProject(name, description);
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  const remove = async () => {
    if (!project) return;
    setBusy(true);
    const problem = await useWorkspaceStore.getState().deleteProject(project.id);
    setBusy(false);
    if (problem) {
      setError(problem);
      setConfirmDelete(false);
    } else {
      onDeleted?.();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-labelledby="project-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={save} className="w-full max-w-md rounded-xl bg-surface border border-line shadow-lg text-ink p-5 select-text">
        <div className="flex items-center gap-3 mb-4">
          <h2 id="project-title" className="flex-1 text-[16px] font-semibold">
            {project ? 'Project settings' : 'New project'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded text-muted hover:text-ink hover:bg-canvas">
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="block text-[12.5px] font-medium mb-1">Name</label>
        <input autoFocus className={`${FIELD} h-9`} value={name} maxLength={LIMITS.maxProjectNameLength} onChange={(e) => setName(e.target.value)} placeholder="e.g. Checkout redesign" aria-label="Project name" />
        <label className="block text-[12.5px] font-medium mt-3 mb-1">Description (optional)</label>
        <textarea className={`${FIELD} h-20 py-2 resize-none`} value={description} maxLength={LIMITS.maxWorkspaceDescriptionLength} onChange={(e) => setDescription(e.target.value)} placeholder="What do the diagrams in this project cover?" aria-label="Project description" />
        {project && (
          <>
            <label className="block text-[12.5px] font-medium mt-3 mb-1.5">Cover</label>
            <CoverPicker value={cover} onChange={setCover} allowPlain />
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center gap-2">
          {project && canDelete && (
            <button
              type="button"
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
              disabled={busy}
              className="h-9 px-3 rounded-lg text-[13px] font-medium text-danger hover:bg-danger/10 flex items-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> {confirmDelete ? `Delete it and its ${project.diagramCount} diagram${project.diagramCount === 1 ? '' : 's'}` : 'Delete'}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-9 px-3.5 rounded-lg border border-line text-[13px] hover:bg-canvas">
            Cancel
          </button>
          <button disabled={busy || !name.trim()} className="h-9 px-4 rounded-lg bg-primary hover:bg-primary-hover disabled:bg-line disabled:text-faint text-white text-[13px] font-medium flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {project ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
};
