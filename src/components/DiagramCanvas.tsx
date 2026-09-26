import React, { useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AWSArchitectureNode } from './AWSArchitectureNode';
import { useDiagramStore } from '../diagram/store';
import { TypewriterPrompt } from './TypewriterPrompt';

const nodeTypes = {
  awsNode: AWSArchitectureNode,
};

const InnerCanvas: React.FC = () => {
  const storeNodes = useDiagramStore((state) => state.nodes);
  const storeEdges = useDiagramStore((state) => state.edges);
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);

  // Keyboard shortcuts: Undo (Ctrl+Z) and Delete (Delete/Backspace)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useDiagramStore.getState().undo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        useDiagramStore.getState().deleteSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const onConnect = React.useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        useDiagramStore.getState().connect(connection.source, connection.target);
      }
    },
    []
  );

  const onNodesDelete = React.useCallback(
    (deleted: any[]) => {
      deleted.forEach((node) => {
        useDiagramStore.getState().removeNode(node.id);
      });
    },
    []
  );

  const onEdgesDelete = React.useCallback(
    (deleted: any[]) => {
      deleted.forEach((edge) => {
        useDiagramStore.getState().disconnect(edge.source, edge.target);
      });
    },
    []
  );

  // Sync ReactFlow internal state when Zustand store updates
  useEffect(() => {
    setNodes(storeNodes);
    setEdges(storeEdges);

    if (storeNodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.25, duration: 400 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [storeNodes, storeEdges, setNodes, setEdges, fitView]);

  const isEmpty = useMemo(() => storeNodes.length === 0, [storeNodes]);

  return (
    <div className="relative w-full h-full bg-[#f7f7f4]">
      {isEmpty && <TypewriterPrompt />}

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
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        className="touch-none"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="#cfcdc4"
        />
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
