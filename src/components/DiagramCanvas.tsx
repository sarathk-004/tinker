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
import type { DiagramNode } from '../types/diagram';

const nodeTypes = {
  awsNode: AWSArchitectureNode,
};
const edgeTypes = { floating: FloatingEdge };

/** The React Flow provider lives in the app shell, so the toolbar can zoom and frame the same canvas. */
export const DiagramCanvas: React.FC = () => {
  const tool = useUi((s) => s.tool);
  const addComponent = useAddComponent();
  const storeNodes = useDiagramStore((state) => state.nodes);
  const storeEdges = useDiagramStore((state) => state.edges);
  const diagramId = useDiagramStore((state) => state.doc.diagram?.id ?? null);
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);

  // Never overwrite React Flow's nodes while the user is dragging one (the server may acknowledge another write meanwhile).
  const dragging = useRef(false);
  const stale = useRef(false);

  const syncFromStore = React.useCallback(() => {
    // Selection belongs to React Flow: carry its selected flags over onto the freshly derived nodes.
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return storeNodes.map((n) => ({ ...n, selected: selected.has(n.id) }));
    });
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return storeEdges.map((e) => ({ ...e, selected: selected.has(e.id) }));
    });
  }, [storeNodes, storeEdges, setNodes, setEdges]);

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
    for (const node of removedNodes) void store.removeNode(node.id);
    for (const edge of removedEdges) {
      if (!removedIds.has(edge.source) && !removedIds.has(edge.target)) void store.disconnectEdge(edge.id);
    }
  }, []);

  const onNodeDragStart = React.useCallback(() => {
    dragging.current = true;
  }, []);

  const onNodeDragStop = React.useCallback(
    (_event: unknown, _node: Node, dragged: Node[]) => {
      dragging.current = false;
      const positions = Object.fromEntries(dragged.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]));
      useDiagramStore.getState().savePositions(positions);
      if (stale.current) {
        stale.current = false;
        syncFromStore();
      }
    },
    [syncFromStore],
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
          useDiagramStore.getState().setSelectedNodeIds(selNodes.map((n) => n.id));
        }}
        onConnect={onConnect}
        onDelete={onDelete}
        onNodeDragStart={onNodeDragStart}
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
