import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDiagramStore } from '../diagram/store';
import type { NewNodeSpec } from '../diagram/adapters';
import { readinessScore, reviewArchitecture, type ComponentSpec, type Finding, type FixAction } from './rules';

const storageKey = (diagramId: string) => `tinker_advisor_dismissed:${diagramId}`;

function loadDismissed(diagramId: string | null): Set<string> {
  if (!diagramId) return new Set();
  try {
    const raw = localStorage.getItem(storageKey(diagramId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

const toSpec = (c: ComponentSpec): NewNodeSpec => ({ label: c.label, type: c.kind, awsIcon: c.icon as NewNodeSpec['awsIcon'], subType: c.technology });

/** Apply a suggested fix as ordinary commands (so it is saved, versioned and undoable like any other edit). */
export async function applyFix(action: FixAction): Promise<void> {
  const store = useDiagramStore.getState();
  if (action.type === 'insertBetween') {
    if (store.edges.some((e) => e.source === action.source && e.target === action.target)) {
      await store.insertBetween(action.source, action.target, toSpec(action.component)); // one atomic INSERT_BETWEEN
      return;
    }
    const id = await store.addNode(toSpec(action.component));
    if (!id) return;
    await store.connect(action.source, id);
    await store.connect(id, action.target);
  } else if (action.type === 'addAfter') {
    const id = await store.addNode(toSpec(action.component));
    if (id) await store.connect(action.from, id, action.relationship);
  } else {
    await store.addNode(toSpec(action.component));
  }
}

export interface Advisor {
  findings: Finding[];
  dismissed: Finding[];
  readiness: number;
  componentCount: number;
  dismiss(id: string): void;
  restoreAll(): void;
}

/** The review of the open diagram, kept up to date as it changes. What the person dismissed stays dismissed for that diagram. */
export function useAdvisor(): Advisor {
  const graphNodes = useDiagramStore((s) => s.doc.graph.nodes);
  const graphEdges = useDiagramStore((s) => s.doc.graph.edges);
  const diagramId = useDiagramStore((s) => s.doc.diagram?.id ?? null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissed(diagramId));
  useEffect(() => setDismissedIds(loadDismissed(diagramId)), [diagramId]);

  const all = useMemo(
    () =>
      reviewArchitecture(
        graphNodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind, technology: n.technology, group: typeof n.metadata['group'] === 'string' ? (n.metadata['group'] as string) : undefined })),
        graphEdges.map((e) => ({ id: e.id, source: e.sourceNodeId, target: e.targetNodeId, relationship: e.relationship })),
      ),
    [graphNodes, graphEdges],
  );

  const persist = useCallback(
    (next: Set<string>) => {
      setDismissedIds(next);
      if (!diagramId) return;
      try {
        localStorage.setItem(storageKey(diagramId), JSON.stringify([...next]));
      } catch {
        /* storage unavailable: dismissed items simply come back next time */
      }
    },
    [diagramId],
  );

  const findings = useMemo(() => all.filter((f) => !dismissedIds.has(f.id)), [all, dismissedIds]);
  return {
    findings,
    dismissed: all.filter((f) => dismissedIds.has(f.id)),
    readiness: readinessScore(findings, graphNodes.length),
    componentCount: graphNodes.length,
    dismiss: (id) => persist(new Set([...dismissedIds, id])),
    restoreAll: () => persist(new Set()),
  };
}
