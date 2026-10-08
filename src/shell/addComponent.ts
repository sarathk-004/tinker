import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDiagramStore } from '../diagram/store';
import type { QuickComponent } from './palette';

/** What a dragged palette card carries (the index into the palette would break if the list changed, so the label identifies it). */
export const COMPONENT_DRAG_TYPE = 'application/x-tinker-component';

/** About half the size of a node card, so the card lands centred on the drop point. */
const HALF = { x: 112, y: 52 };

/**
 * Add a component from the palette. Dropped on the canvas it appears under the pointer; added with a click it appears in the middle of what
 * is on screen. Either way the server keeps the spot unless another component is already there, then picks the nearest free one.
 */
export function useAddComponent(): (c: QuickComponent, at?: { clientX: number; clientY: number }) => Promise<string | null> {
  const flow = useReactFlow();
  return useCallback(
    (c, at) => {
      const canvas = document.querySelector('.react-flow');
      const rect = canvas?.getBoundingClientRect();
      const screen = at ?? (rect ? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } : { clientX: 0, clientY: 0 });
      const p = flow.screenToFlowPosition({ x: screen.clientX, y: screen.clientY });
      return useDiagramStore.getState().addNode({ label: c.label, type: c.type, awsIcon: c.awsIcon, subType: c.subType, position: { x: p.x - HALF.x, y: p.y - HALF.y } });
    },
    [flow],
  );
}
