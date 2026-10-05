import React, { useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AWSArchitectureNode } from './AWSArchitectureNode';
import { useDiagramStore } from '../diagram/store';
import { TypewriterPrompt } from './TypewriterPrompt';
import type { DiagramNode } from '../types/diagram';

const nodeTypes = {
  awsNode: AWSArchitectureNode,
};

const InnerCanvas: React.FC = () => {
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
      const timer = setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 60);
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

  return (
    <div className="relative w-full h-full bg-[#f7f7f4]">
      {isEmpty && diagramId && <TypewriterPrompt />}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        className="touch-none"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#cfcdc4" />
        <Controls
          className="!bg-white !border !border-[#e6e5e0] !rounded-md overflow-hidden [&>button]:!bg-transparent [&>button]:!border-[#e6e5e0] [&>button]:!text-[#26251e] hover:[&>button]:!bg-[#fafaf7]"
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  );
};

export const DiagramCanvas: React.FC = () => {
  return (
    <ReactFlowProvider>
      <InnerCanvas />
    </ReactFlowProvider>
  );
};
