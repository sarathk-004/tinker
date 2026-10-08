import React from 'react';
import type { DiagramCard, ProjectCover, ProjectSummary } from '../contracts';
import { autoPreset, presetOf, type CoverPreset } from '../catalog/covers';
import { DiagramThumb } from './DiagramThumb';
import { DitherGradient } from './dither-kit/gradient';

export const PresetArt: React.FC<{ preset: CoverPreset; className?: string }> = ({ preset, className = '' }) => (
  <div className={`relative overflow-hidden bg-canvas ${className}`}>
    <DitherGradient from={preset.from} to={preset.to} direction={preset.direction} cell={4} opacity={0.85} />
  </div>
);

/** The preset a project shows: the one it chose, or (automatic) one picked from its id so every project looks its own. "preview" has none. */
export function presetFor(id: string, cover: ProjectCover | null): CoverPreset | null {
  if (cover === 'preview') return null;
  return (cover && presetOf(cover)) || autoPreset(id);
}

/**
 * A cover: the project's dithered backdrop with a drawing of a diagram laid over it. The same project looks the same everywhere it
 * appears (dashboard, workspace, project page, the editor), because the backdrop comes from the project's id and its chosen cover.
 */
export const CoverArt: React.FC<{ projectId: string; cover: ProjectCover | null; preview?: DiagramCard['preview'] | null; className?: string; bare?: boolean }> = ({ projectId, cover, preview, className = '', bare = false }) => {
  const preset = presetFor(projectId, cover);
  return (
    <div className={`img-outline relative overflow-hidden bg-canvas ${className}`}>
      {preset && <DitherGradient from={preset.from} to={preset.to} direction={preset.direction} cell={4} opacity={0.85} />}
      {!bare && preview && preview.nodes.length > 0 && <DiagramThumb preview={preview} className="relative w-full h-full p-1.5" />}
    </div>
  );
};

/** A project's cover, from what the server sends about it. */
export const ProjectCoverArt: React.FC<{ project: Pick<ProjectSummary, 'id' | 'cover' | 'latestDiagram'>; className?: string }> = ({ project, className = '' }) => (
  <CoverArt projectId={project.id} cover={project.cover} preview={project.latestDiagram?.preview ?? null} className={className} />
);
