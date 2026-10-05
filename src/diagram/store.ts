/**
 * Editor working state (Zustand). It is a VIEW over the document session, never the source of truth:
 *  - `doc` mirrors the session (acknowledged canonical graph + presentation, save status, conflicts, notices);
 *  - `nodes` / `edges` are derived from it for React Flow;
 *  - selection, highlight, layout direction and flow animation are ephemeral UI state and are never persisted.
 * Every structural action below sends a DiagramCommand through the session (one serialized, idempotent write path).
 */
import { create } from 'zustand';
import type { DiagramCommand } from '../contracts';
import { session } from '../document/instance';
import { newNodeIds, type SessionState } from '../document/session';
import type { Position } from '../contracts';
import type { DiagramEdge, DiagramNode } from '../types/diagram';
import { addNodeCommand, groupCommand, insertBetweenCommand, nodeEditCommands, toViewEdges, toViewNodes, type NewNodeSpec } from './adapters';
import { playFlow as runFlow } from './flow';
import { getLayoutedElements } from './layout';
import type { AWSServiceIcon, SystemNodeType } from '../types/diagram';

export interface NodeEdit {
  label: string;
  subType: string;
  awsIcon: AWSServiceIcon;
  type: SystemNodeType;
  description?: string;
}

interface Ephemeral {
  highlightedIds: string[];
  selectedNodeIds: string[];
  activeAction: string | null;
  isPlayingFlow: boolean;
  layoutDir: 'LR' | 'TB';
}

export interface DiagramView extends Ephemeral {
  doc: SessionState;
  nodes: DiagramNode[];
  edges: DiagramEdge[];

  addNode(spec: NewNodeSpec): Promise<string | null>;
  removeNode(id: string): Promise<void>;
  deleteSelected(): Promise<void>;
  connect(source: string, target: string, label?: string, bidirectional?: boolean): Promise<void>;
  disconnectEdge(edgeId: string): Promise<void>;
  editNode(id: string, edit: NodeEdit): Promise<void>;
  insertBetween(source: string, target: string, spec: NewNodeSpec): Promise<string | null>;
  groupNodes(ids: string[], groupName: string): Promise<void>;
  reset(): Promise<void>;
  applyLayout(direction?: 'LR' | 'TB'): Promise<void>;
  /** Drag-end positions: shown at once, saved after a short quiet period. */
  savePositions(positions: Record<string, Position>): void;

  setSelectedNodeIds(ids: string[]): void;
  highlight(ids: string[]): void;
  clearHighlight(): void;
  playFlow(sequence?: string[]): Promise<void>;
}

const derive = (doc: SessionState, ui: Pick<Ephemeral, 'highlightedIds' | 'layoutDir'>) => ({
  nodes: toViewNodes(doc.graph, doc.presentation, ui),
  edges: toViewEdges(doc.graph, ui.highlightedIds),
});

/** Commands report their outcome through the session (status, notices); the UI never needs the rejection itself. */
const settle = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export const useDiagramStore = create<DiagramView>((set, get) => {
  const initialDoc = session.getState();
  const initialUi = { highlightedIds: [] as string[], layoutDir: 'LR' as const };

  const run = async (command: DiagramCommand, label: string) => {
    const res = await settle(session.command(command, label), undefined);
    if (res) set({ activeAction: label });
    return res;
  };

  return {
    doc: initialDoc,
    ...derive(initialDoc, initialUi),
    ...initialUi,
    selectedNodeIds: [],
    activeAction: null,
    isPlayingFlow: false,

    async addNode(spec) {
      const before = session.getState().graph;
      const res = await run(addNodeCommand(spec), `Added ${spec.label}`);
      return res ? (newNodeIds(before, res.graph)[0] ?? null) : null;
    },

    async removeNode(id) {
      const name = get().doc.graph.nodes.find((n) => n.id === id)?.name ?? 'node';
      await run({ type: 'REMOVE_NODE', nodeId: id }, `Removed ${name}`);
      set((s) => ({ selectedNodeIds: s.selectedNodeIds.filter((n) => n !== id) }));
    },

    async deleteSelected() {
      const ids = get().selectedNodeIds.length > 0 ? get().selectedNodeIds : get().nodes.filter((n) => n.selected).map((n) => n.id);
      if (ids.length === 0) return;
      for (const id of ids) void get().removeNode(id); // queued in order by the session
      set({ selectedNodeIds: [] });
    },

    async connect(source, target, label, bidirectional) {
      if (source === target) return;
      await run(
        {
          type: 'CONNECT',
          sourceNodeId: source,
          targetNodeId: target,
          ...(label ? { relationship: label } : {}),
          ...(bidirectional ? { metadata: { bidirectional: true } } : {}),
        },
        'Connected nodes',
      );
    },

    async disconnectEdge(edgeId) {
      await run({ type: 'DISCONNECT', edgeId }, 'Removed connection');
    },

    async editNode(id, edit) {
      const node = get().doc.graph.nodes.find((n) => n.id === id);
      if (!node) return;
      for (const command of nodeEditCommands(node, edit)) void run(command, `Updated ${edit.label || node.name}`);
      await settle(session.flush(), undefined);
    },

    async insertBetween(source, target, spec) {
      const before = session.getState().graph;
      const res = await run(insertBetweenCommand(source, target, spec), `Inserted ${spec.label}`);
      return res ? (newNodeIds(before, res.graph)[0] ?? null) : null;
    },

    async groupNodes(ids, groupName) {
      for (const id of ids) {
        const node = get().doc.graph.nodes.find((n) => n.id === id);
        if (node) void run(groupCommand(node, groupName), `Grouped as ${groupName}`);
      }
      await settle(session.flush(), undefined);
    },

    async reset() {
      await run({ type: 'RESET' }, 'Reset canvas');
      set({ highlightedIds: [], selectedNodeIds: [] });
    },

    async applyLayout(direction) {
      const dir = direction ?? get().layoutDir;
      const { nodes, edges } = get();
      const laidOut = getLayoutedElements(nodes, edges, dir).nodes;
      set((s) => ({ layoutDir: dir, ...derive(s.doc, { highlightedIds: s.highlightedIds, layoutDir: dir }) }));
      session.savePositions(Object.fromEntries(laidOut.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])));
      await settle(session.flush(), undefined);
    },

    savePositions(positions) {
      session.savePositions(positions);
    },

    setSelectedNodeIds(ids) {
      set({ selectedNodeIds: ids });
    },

    highlight(ids) {
      set((s) => ({ highlightedIds: ids, activeAction: `Highlighted ${ids.length} component${ids.length === 1 ? '' : 's'}`, ...derive(s.doc, { highlightedIds: ids, layoutDir: s.layoutDir }) }));
    },

    clearHighlight() {
      set((s) => ({ highlightedIds: [], ...derive(s.doc, { highlightedIds: [], layoutDir: s.layoutDir }) }));
    },

    async playFlow(sequence) {
      await runFlow(
        {
          getNodes: () => get().nodes,
          getEdges: () => get().edges,
          setView: (patch) => set(patch),
          clearHighlight: () => get().clearHighlight(),
        },
        sequence,
      );
    },
  };
});

// The session is the only writer of `doc`; the view is re-derived on every change.
session.subscribe((doc) => {
  useDiagramStore.setState((s) => ({ doc, ...derive(doc, { highlightedIds: s.highlightedIds, layoutDir: s.layoutDir }) }));
});
