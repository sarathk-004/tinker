import { useDiagramStore } from '../diagram/store';
import { useUi } from './uiStore';

/** Group the selected components, then let the person name the new group right away. */
export async function groupSelected(): Promise<void> {
  const store = useDiagramStore.getState();
  const path = await store.groupNodes(store.selectedNodeIds);
  if (path) useUi.getState().set({ editingGroupPath: path });
}
