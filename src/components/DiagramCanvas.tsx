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
    <div className="relative w-full h-full bg-[#080a0f]">
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center max-w-md text-center px-6 py-8 rounded-2xl bg-[#10141e]/70 border border-slate-800/80 backdrop-blur-xl shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4 shadow-lg shadow-amber-500/5">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white mb-2 font-display">
              Talk through what you're building
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              Describe your architecture verbally or run the interactive demo steps. Tinker will construct and restructure the AWS system in real time.
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-full">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Try: <span className="text-slate-300 italic">"Client talks to API Gateway, then to Orders and Auth"</span></span>
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
          color="#1e2638"
        />
        <Controls
          className="!bg-[#121620] !border !border-slate-800 !rounded-xl !shadow-2xl overflow-hidden [&>button]:!bg-transparent [&>button]:!border-slate-800 [&>button]:!text-slate-300 hover:[&>button]:!bg-slate-800 hover:[&>button]:!text-white"
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
