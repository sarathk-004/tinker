import type { ProjectCover } from '../contracts';
import type { DitherColor } from '../components/dither-kit/palette';
import type { GradientDirection } from '../components/dither-kit/gradient';

/** The dithered covers a project can have (drawn by the Dither Kit gradient). "preview" is not here: it shows the latest diagram instead. */
export interface CoverPreset {
  id: Exclude<ProjectCover, 'preview'>;
  label: string;
  from: DitherColor;
  to: DitherColor;
  direction: GradientDirection;
}

export const COVER_PRESETS: readonly CoverPreset[] = [
  { id: 'dusk', label: 'Dusk', from: 'purple', to: 'blue', direction: 'up' },
  { id: 'ember', label: 'Ember', from: 'orange', to: 'red', direction: 'right' },
  { id: 'meadow', label: 'Meadow', from: 'green', to: 'blue', direction: 'down' },
  { id: 'rose', label: 'Rose', from: 'pink', to: 'purple', direction: 'left' },
  { id: 'ocean', label: 'Ocean', from: 'blue', to: 'green', direction: 'up' },
  { id: 'sunrise', label: 'Sunrise', from: 'orange', to: 'pink', direction: 'up' },
  { id: 'slate', label: 'Slate', from: 'grey', to: 'blue', direction: 'right' },
  { id: 'mint', label: 'Mint', from: 'green', to: 'grey', direction: 'down' },
];

export const presetOf = (id: string): CoverPreset | undefined => COVER_PRESETS.find((p) => p.id === id);

/** A stable pick from the presets for a project that has no cover and nothing in it yet. */
export function autoPreset(seed: string): CoverPreset {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_PRESETS[h % COVER_PRESETS.length]!;
}

/** What a project's cover shows: a preset, or the latest diagram's drawing. */
export type CoverView = { kind: 'preset'; preset: CoverPreset } | { kind: 'preview' };

export function coverView(project: { id: string; cover: ProjectCover | null; latestDiagram: unknown | null }): CoverView {
  if (project.cover && project.cover !== 'preview') {
    const preset = presetOf(project.cover);
    if (preset) return { kind: 'preset', preset };
  }
  if (project.cover === 'preview' || project.latestDiagram) return { kind: 'preview' };
  return { kind: 'preset', preset: autoPreset(project.id) };
}
