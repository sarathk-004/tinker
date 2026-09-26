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
    <div className="relative w-full h-full bg-[#f7f7f4]">
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center max-w-md text-center px-8 py-8 rounded-lg bg-white border border-[#e6e5e0]">
            <div className="w-10 h-10 rounded-md bg-[#fafaf7] border border-[#e6e5e0] flex items-center justify-center text-[#f54e00] mb-4">
              <Sparkles className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-normal tracking-[-0.5px] text-[#26251e] mb-2 font-sans">
              Talk through what you're building
            </h2>
            <p className="text-sm text-[#5a5852] leading-relaxed mb-5">
              Describe your architecture verbally or run interactive commands. Tinker constructs and restructures the AWS system in real time.
            </p>
            <div className="flex items-center gap-2 text-xs text-[#5a5852] bg-[#fafaf7] border border-[#e6e5e0] px-3.5 py-1.5 rounded-full font-mono">
              <Layers className="w-3.5 h-3.5 text-[#f54e00]" />
              <span>Try: <span className="text-[#26251e] italic">"Client talks to API Gateway, then to Orders and Auth"</span></span>
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
