import { playSound } from '../sound/uiSound';
import { useDiagramStore } from '../diagram/store';
import { exportDiagram, type CanvasHandle, type ExportFormat } from './exportDiagram';

/** Export the diagram that is open, exactly as last saved (queued edits are not part of it until they are saved). */
export async function exportCurrent(format: ExportFormat, canvas: CanvasHandle): Promise<string | null> {
  const doc = useDiagramStore.getState().doc;
  if (!doc.diagram) return 'Open a diagram first.';
  try {
    await exportDiagram({ name: doc.diagram.name, version: doc.diagram.version, graph: doc.graph, presentation: doc.presentation }, format, canvas);
    playSound('check');
    return null;
  } catch (e) {
    playSound('deny');
    return e instanceof Error ? e.message : 'The export did not work.';
  }
}
