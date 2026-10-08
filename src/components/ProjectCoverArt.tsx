import React from 'react';
import type { ProjectSummary } from '../contracts';
import { coverView, type CoverPreset } from '../catalog/covers';
import { DiagramThumb } from './DiagramThumb';
import { DitherGradient } from './dither-kit/gradient';

export const PresetArt: React.FC<{ preset: CoverPreset; className?: string }> = ({ preset, className = '' }) => (
  <div className={`relative overflow-hidden bg-canvas ${className}`}>
    <DitherGradient from={preset.from} to={preset.to} direction={preset.direction} cell={4} opacity={0.85} />
  </div>
);

/** A project's cover: a dithered cover, or a drawing of the diagram it was last worked on. */
export const ProjectCoverArt: React.FC<{ project: Pick<ProjectSummary, 'id' | 'cover' | 'latestDiagram'>; className?: string }> = ({ project, className = '' }) => {
  const view = coverView(project);
  if (view.kind === 'preset') return <PresetArt preset={view.preset} className={className} />;
  return (
    <div className={`relative overflow-hidden bg-canvas ${className}`}>
      {project.latestDiagram ? <DiagramThumb preview={project.latestDiagram.preview} className="w-full h-full" /> : <PresetArtFallback />}
    </div>
  );
};

const PresetArtFallback: React.FC = () => <div className="w-full h-full flex items-center justify-center text-[12px] text-muted">No diagram yet</div>;
