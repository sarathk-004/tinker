import React, { useEffect, useRef } from 'react';
import {
  ReactFlow,
  ConnectionMode,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AWSArchitectureNode } from './AWSArchitectureNode';
import { FloatingEdge } from './FloatingEdge';
import { useDiagramStore } from '../diagram/store';
import { EmptyCanvas } from './EmptyCanvas';
import { useUi } from '../shell/uiStore';
import { COMPONENT_DRAG_TYPE, useAddComponent } from '../shell/addComponent';
import { PALETTE } from '../shell/palette';
import { NoteNode } from './NoteNode';
import { GroupBox } from './GroupBox';
import { computeGroupBoxes, groupNodeId, groupPathOfNodeId, isGroupNodeId, regroupAfterDrag, reparentAfterGroupDrag, type PlacedNode } from '../diagram/groups';
import { isInGroup } from '../contracts';
import { isNoteNodeId, noteActions, noteIdOf, noteNodeId } from '../diagram/notes';
import type { Note } from '../contracts';

const nodeTypes = {
  awsNode: AWSArchitectureNode,
  note: NoteNode,
  groupBox: GroupBox,
};
const edgeTypes = { floating: FloatingEdge };

/** Every group as a dotted boundary node. Boxes are derived from where their components are, so they follow them whenever they move. */
const groupBoxNodes = (placed: readonly PlacedNode[]): Node[] =>
  computeGroupBoxes(placed).map((b) => ({
    id: groupNodeId(b.path),
    type: 'groupBox',
    position: { x: b.x, y: b.y },
    data: { path: b.path, label: b.label, count: b.memberIds.length },
    style: { width: b.width, height: b.height, pointerEvents: 'none' as const },
    dragHandle: '.group-handle',
    zIndex: -10 + b.depth,
    deletable: true,
  }));

/** The saved notes as canvas nodes (they sit above the components so they stay readable). */
const noteNodes = (notes: readonly Note[]): Node[] =>
  notes.map((n) => ({
    id: noteNodeId(n.id),
    type: 'note',
    position: { x: n.x, y: n.y },
    data: { noteId: n.id, text: n.text },
    style: { width: n.width ?? 240 },
    zIndex: 5,
  }));

/** The React Flow provider lives in the app shell, so the toolbar can zoom and frame the same canvas. */
export const DiagramCanvas: React.FC = () => {
  const tool = useUi((s) => s.tool);
  const addComponent = useAddComponent();
  const storeNodes = useDiagramStore((state) => state.nodes);
  const storeEdges = useDiagramStore((state) => state.edges);
  const diagramId = useDiagramStore((state) => state.doc.diagram?.id ?? null);
  const notes = useDiagramStore((state) => state.doc.presentation.notes);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const placed = React.useMemo<PlacedNode[]>(() => storeNodes.map((n) => ({ id: n.id, group: n.data.group, x: n.position.x, y: n.position.y })), [storeNodes]);
  const extraNodes = React.useMemo(() => [...groupBoxNodes(placed), ...noteNodes(notes ?? [])], [placed, notes]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([...storeNodes, ...extraNodes]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);

  // Never overwrite React Flow's nodes while the user is dragging one (the server may acknowledge another write meanwhile).
  const dragging = useRef(false);
  const stale = useRef(false);

  const syncFromStore = React.useCallback(() => {
    // Selection belongs to React Flow: carry its selected flags over onto the freshly derived nodes.
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return [...storeNodes, ...extraNodes].map((n) => ({ ...n, selected: selected.has(n.id) }));
    });
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return storeEdges.map((e) => ({ ...e, selected: selected.has(e.id) }));
    });
  }, [storeNodes, extraNodes, storeEdges, setNodes, setEdges]);

  useEffect(() => {
    if (dragging.current) {
      stale.current = true;
      return;
    }
    syncFromStore();
  }, [syncFromStore]);

  // Frame the diagram when a different diagram opens or the first nodes appear, not after every edit (positions are persisted).
  const framedFor = useRef<{ id: string | null; hadNodes: boolean }>({ id: null, hadNodes: false });
  useEffect(() => {
    const hasNodes = storeNodes.length > 0;
    const prev = framedFor.current;
    if (hasNodes && (prev.id !== diagramId || !prev.hadNodes)) {
      const timer = setTimeout(() => fitView({ padding: 0.25, duration: 400, maxZoom: 1 }), 60);
      framedFor.current = { id: diagramId, hadNodes: true };
      return () => clearTimeout(timer);
    }
    framedFor.current = { id: diagramId, hadNodes: hasNodes };
    return undefined;
  }, [diagramId, storeNodes.length, fitView]);

  const onConnect = React.useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      void useDiagramStore.getState().connect(connection.source, connection.target);
    }
  }, []);

  // One handler for nodes AND edges: deleting a node removes its connections on the server, so those edges must not
  // also be sent as separate disconnect commands.
  const onDelete = React.useCallback(({ nodes: removedNodes, edges: removedEdges }: { nodes: Node[]; edges: Edge[] }) => {
    const store = useDiagramStore.getState();
    const removedIds = new Set(removedNodes.map((n) => n.id));
    // Notes are not components: they are removed from the saved notes, not with a REMOVE_NODE command.
    const removedNotes = removedNodes.filter((n) => isNoteNodeId(n.id)).map((n) => noteIdOf(n.id));
    if (removedNotes.length > 0) noteActions.remove(removedNotes);
    for (const node of removedNodes) if (isGroupNodeId(node.id)) void store.ungroup(groupPathOfNodeId(node.id));
    for (const node of removedNodes) if (!isNoteNodeId(node.id) && !isGroupNodeId(node.id)) void store.removeNode(node.id);
    for (const edge of removedEdges) {
      if (!removedIds.has(edge.source) && !removedIds.has(edge.target)) void store.disconnectEdge(edge.id);
    }
  }, []);

  // Dragging a boundary moves the whole group: its components and the boundaries inside it follow while the pointer moves.
  const nodesRef = useRef<Node[]>([]);
  nodesRef.current = nodes;
  const groupDrag = useRef<{ path: string; origin: { x: number; y: number }; start: Record<string, { x: number; y: number }> } | null>(null);

  const onNodeDragStart = React.useCallback((_e: unknown, node: Node) => {
    dragging.current = true;
    if (!isGroupNodeId(node.id)) return;
    const path = groupPathOfNodeId(node.id);
    const members = new Set(placed.filter((p) => isInGroup(p.group, path)).map((p) => p.id));
    const start: Record<string, { x: number; y: number }> = {};
    for (const n of nodesRef.current) {
      if (n.id === node.id) continue;
      const inner = isGroupNodeId(n.id) && isInGroup(groupPathOfNodeId(n.id), path);
      if (members.has(n.id) || inner) start[n.id] = { ...n.position };
    }
    groupDrag.current = { path, origin: { ...node.position }, start };
  }, [placed]);

  const onNodeDrag = React.useCallback(
    (_e: unknown, node: Node) => {
      const g = groupDrag.current;
      if (!g || node.id !== groupNodeId(g.path)) return;
      const dx = node.position.x - g.origin.x;
      const dy = node.position.y - g.origin.y;
      setNodes((prev) => prev.map((n) => (g.start[n.id] ? { ...n, position: { x: g.start[n.id]!.x + dx, y: g.start[n.id]!.y + dy } } : n)));
    },
    [setNodes],
  );

  const onNodeDragStop = React.useCallback(
    (_event: unknown, node: Node, dragged: Node[]) => {
      dragging.current = false;
      const store = useDiagramStore.getState();
      const g = groupDrag.current;
      groupDrag.current = null;

      if (g && node.id === groupNodeId(g.path)) {
        // The whole group moved: save where its components ended up, then see whether it was dropped into (or out of) another group.
        const dx = node.position.x - g.origin.x;
        const dy = node.position.y - g.origin.y;
        const moved = Object.fromEntries(
          Object.entries(g.start)
            .filter(([id]) => !isGroupNodeId(id))
            .map(([id, p]) => [id, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) }]),
        );
        if (Object.keys(moved).length > 0) store.savePositions(moved);
        const after = placed.map((p) => (moved[p.id] ? { ...p, ...moved[p.id]! } : p));
        const box = computeGroupBoxes(after).find((b) => b.path === g.path);
        const next = box ? reparentAfterGroupDrag(after, g.path, box) : null;
        if (next) void store.renameGroup(g.path, next);
      } else {
        const components = dragged.filter((n) => !isNoteNodeId(n.id) && !isGroupNodeId(n.id));
        const positions = Object.fromEntries(components.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]));
        if (components.length > 0) {
          store.savePositions(positions);
          // A component dropped inside a boundary joins that group; one dragged clear of its boundary leaves it.
          const after = placed.map((p) => (positions[p.id] ? { ...p, ...positions[p.id]! } : p));
          for (const change of regroupAfterDrag(after, components.map((n) => n.id))) void store.setNodesGroup(change.nodeIds, change.group);
        }
        for (const n of dragged) if (isNoteNodeId(n.id)) noteActions.update(noteIdOf(n.id), { x: Math.round(n.position.x), y: Math.round(n.position.y) });
      }
      if (stale.current) {
        stale.current = false;
        syncFromStore();
      }
    },
    [syncFromStore, placed],
  );

  const isEmpty = storeNodes.length === 0;

  // A component dragged from the Components tab and dropped here is added where it was dropped.
  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(COMPONENT_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);
  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      const label = e.dataTransfer.getData(COMPONENT_DRAG_TYPE);
      const component = PALETTE.find((c) => c.label === label);
      if (!component) return;
      e.preventDefault();
      void addComponent(component, { clientX: e.clientX, clientY: e.clientY });
    },
    [addComponent],
  );

  return (
    <div className="relative w-full h-full bg-[#f7f7f4]" onDragOver={onDragOver} onDrop={onDrop}>
      {isEmpty && diagramId && <EmptyCanvas />}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Loose: a connection can start or end on any of a component's four points, top and bottom included.
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={({ nodes: selNodes }) => {
          useDiagramStore.getState().setSelectedNodeIds(selNodes.filter((n) => !isNoteNodeId(n.id) && !isGroupNodeId(n.id)).map((n) => n.id));
          const boxes = selNodes.filter((n) => isGroupNodeId(n.id));
          useUi.getState().set({ selectedGroupPath: boxes.length === 1 && selNodes.length === 1 ? groupPathOfNodeId(boxes[0]!.id) : null });
        }}
        onPaneClick={(e) => {
          if (tool !== 'text') return;
          const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          const note = noteActions.add(p.x - 20, p.y - 14);
          if (note) useUi.getState().set({ editingNoteId: note.id, tool: 'pan' });
        }}
        onConnect={onConnect}
        onDelete={onDelete}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        deleteKeyCode={['Backspace', 'Delete']}
        // Select tool: drag on empty canvas draws a selection box and Space (or the middle/right button) pans. Pan tool: drag pans.
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'pan' ? true : [1, 2]}
        panActivationKeyCode="Space"
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        className="touch-none"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#cfcdc4" />
      </ReactFlow>
    </div>
  );
};
