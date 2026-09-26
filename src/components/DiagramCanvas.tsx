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
import { Sparkles, Layers } from 'lucide-react';

const nodeTypes = {
  awsNode: AWSArchitectureNode,
};

const InnerCanvas: React.FC = () => {
  const storeNodes = useDiagramStore((state) => state.nodes);
  const storeEdges = useDiagramStore((state) => state.edges);
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);

  // Keyboard shortcut for Undo (Ctrl+Z or Cmd+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger undo when typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useDiagramStore.getState().undo();
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
    <div className="relative w-full h-full bg-[#001e2b]">
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center max-w-md text-center px-6 py-8 rounded-2xl bg-[#002636]/90 border border-[#1c2d38] backdrop-blur-xl shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-[#00ed64]/10 border border-[#00ed64]/20 flex items-center justify-center text-[#00ed64] mb-4 shadow-lg shadow-[#00ed64]/5">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white mb-2 font-display">
              Talk through what you're building
            </h2>
            <p className="text-sm text-[#a8b3bc] leading-relaxed mb-4">
              Describe your architecture verbally or run interactive commands. Tinker will construct and restructure the AWS system in real time.
            </p>
            <div className="flex items-center gap-2 text-xs text-[#a8b3bc] bg-[#001e2b] border border-[#1c2d38] px-3.5 py-1.5 rounded-full">
              <Layers className="w-3.5 h-3.5 text-[#00ed64]" />
              <span>Try: <span className="text-white italic">"Client talks to API Gateway, then to Orders and Auth"</span></span>
            </div>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
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
          color="#1c2d38"
        />
        <Controls
          className="!bg-[#001e2b] !border !border-[#1c2d38] !rounded-2xl !shadow-2xl overflow-hidden [&>button]:!bg-transparent [&>button]:!border-[#1c2d38] [&>button]:!text-[#a8b3bc] hover:[&>button]:!bg-[#002636] hover:[&>button]:!text-white"
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
