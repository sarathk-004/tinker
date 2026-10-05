import React, { useState } from 'react';
import { useDiagramStore } from '../diagram/store';
import {
  Plus,
  LayoutGrid,
  Trash2,
  ChevronDown,
  Layers,
  Edit3,
  Play,
} from 'lucide-react';
import { AWSIcon } from './icons/AWSIcons';
import { AWSServiceIcon, SystemNodeType } from '../types/diagram';
import { NodeEditModal } from './NodeEditModal';

interface QuickComponent {
  label: string;
  type: SystemNodeType;
  awsIcon: AWSServiceIcon;
  subType?: string;
  category: 'Compute' | 'Networking' | 'Storage & DB' | 'Queues & Events' | 'Security';
}

const PALETTE: QuickComponent[] = [
  // Compute
  { label: 'EC2 Microservice', type: 'service', awsIcon: 'ec2', subType: 'Amazon EC2', category: 'Compute' },
  { label: 'AWS Lambda', type: 'service', awsIcon: 'lambda', subType: 'AWS Lambda', category: 'Compute' },
  { label: 'Amazon EKS', type: 'service', awsIcon: 'eks', subType: 'Amazon EKS', category: 'Compute' },
  { label: 'Step Functions', type: 'service', awsIcon: 'step-functions', subType: 'AWS Step Functions', category: 'Compute' },

  // Networking
  { label: 'API Gateway', type: 'gateway', awsIcon: 'api-gateway', subType: 'Amazon API Gateway', category: 'Networking' },
  { label: 'App Load Balancer', type: 'gateway', awsIcon: 'alb', subType: 'Application Load Balancer', category: 'Networking' },
  { label: 'CloudFront CDN', type: 'gateway', awsIcon: 'cloudfront', subType: 'Amazon CloudFront', category: 'Networking' },
  { label: 'Route 53 DNS', type: 'gateway', awsIcon: 'route53', subType: 'Amazon Route 53', category: 'Networking' },

  // Storage & DB
  { label: 'PostgreSQL DB', type: 'database', awsIcon: 'rds', subType: 'Amazon RDS (PostgreSQL)', category: 'Storage & DB' },
  { label: 'DynamoDB', type: 'database', awsIcon: 'dynamodb', subType: 'Amazon DynamoDB', category: 'Storage & DB' },
  { label: 'Redis Cache', type: 'cache', awsIcon: 'redis', subType: 'ElastiCache / Redis', category: 'Storage & DB' },
  { label: 'OpenSearch', type: 'database', awsIcon: 'opensearch', subType: 'Amazon OpenSearch', category: 'Storage & DB' },
  { label: 'S3 Storage', type: 'storage', awsIcon: 's3', subType: 'Amazon S3', category: 'Storage & DB' },

  // Queues & Events
  { label: 'SQS Queue', type: 'queue', awsIcon: 'sqs', subType: 'Amazon SQS', category: 'Queues & Events' },
  { label: 'SNS Notifications', type: 'queue', awsIcon: 'sns', subType: 'Amazon SNS', category: 'Queues & Events' },
  { label: 'EventBridge', type: 'queue', awsIcon: 'eventbridge', subType: 'Amazon EventBridge', category: 'Queues & Events' },
  { label: 'Kinesis Stream', type: 'queue', awsIcon: 'kinesis', subType: 'Amazon Kinesis', category: 'Queues & Events' },

  // Security & Client
  { label: 'AWS Cognito', type: 'service', awsIcon: 'cognito', subType: 'AWS Cognito (Auth)', category: 'Security' },
  { label: 'AWS WAF', type: 'gateway', awsIcon: 'waf', subType: 'AWS WAF', category: 'Security' },
  { label: 'Secrets Manager', type: 'service', awsIcon: 'secrets-manager', subType: 'AWS Secrets Manager', category: 'Security' },
  { label: 'Web Client', type: 'client', awsIcon: 'client', subType: 'Web / Mobile Client', category: 'Security' },
];

export const ManualToolbar: React.FC = () => {
  const store = useDiagramStore();
  const [showPalette, setShowPalette] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const selectedCount = store.selectedNodeIds.length;
  const isPlayingFlow = store.isPlayingFlow;

  const handleAdd = (comp: QuickComponent) => {
    void store.addNode({
      label: comp.label,
      type: comp.type,
      awsIcon: comp.awsIcon,
      subType: comp.subType,
    });
    setShowPalette(false);
  };

  const handleGroup = () => {
    const selected = store.selectedNodeIds;
    if (selected.length >= 2) {
      void store.groupNodes(selected, 'Backend Services');
    } else if (store.nodes.length >= 2) {
      // Group all service nodes or first 3
      const serviceNodes = store.nodes
        .filter((n) => n.data.type === 'service' || n.data.type === 'database' || n.data.type === 'cache')
        .map((n) => n.id);
      const toGroup = serviceNodes.length >= 2 ? serviceNodes : store.nodes.slice(0, 3).map((n) => n.id);
      void store.groupNodes(toGroup, 'Backend Services');
    }
  };

  const handleDelete = () => {
    void store.deleteSelected();
  };

  const handleOpenEdit = () => {
    if (store.selectedNodeIds.length > 0) {
      setEditingNodeId(store.selectedNodeIds[0]);
    } else if (store.nodes.length > 0) {
      setEditingNodeId(store.nodes[store.nodes.length - 1].id);
    }
  };

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 p-1 rounded-md bg-white border border-[#e6e5e0] select-none shadow-xs">
        {/* Component Palette Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowPalette(!showPalette)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#f54e00] hover:bg-[#d04200] text-white text-xs font-medium transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Node</span>
            <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
          </button>

          {showPalette && (
            <div className="absolute top-full left-0 mt-2 w-72 p-2 rounded-md bg-white border border-[#e6e5e0] z-50 flex flex-col gap-1 shadow-md max-h-96 overflow-y-auto animate-fade-in">
              <div className="px-2 py-1 text-[11px] font-mono font-medium text-[#807d72] uppercase tracking-wider border-b border-[#e6e5e0] mb-1">
                AWS Architecture Palette
              </div>
              {PALETTE.map((comp) => (
                <button
                  key={comp.label}
                  onClick={() => handleAdd(comp)}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[#26251e] hover:bg-[#fafaf7] transition-colors text-left"
                >
                  <AWSIcon name={comp.awsIcon} type={comp.type} size={18} />
                  <div className="truncate flex-1">
                    <div className="truncate">{comp.label}</div>
                    <div className="text-[10px] text-[#807d72]">{comp.subType}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-[#e6e5e0] mx-0.5" />

        {/* Edit / Rename Manual Edit Button */}
        <button
          onClick={handleOpenEdit}
          disabled={store.nodes.length === 0}
          title="Edit or Rename component"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] disabled:opacity-40 disabled:hover:bg-transparent text-xs font-medium transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5 text-[#807d72]" />
          <span className="hidden sm:inline">Rename / Edit</span>
        </button>

        {/* Group Button */}
        <button
          onClick={handleGroup}
          disabled={store.nodes.length < 2}
          title="Tag the selected nodes with a group name"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] disabled:opacity-40 disabled:hover:bg-transparent text-xs font-medium transition-colors"
        >
          <Layers className="w-3.5 h-3.5 text-[#807d72]" />
          <span className="hidden sm:inline">
            Group{selectedCount > 1 ? ` (${selectedCount})` : ''}
          </span>
        </button>

        {/* Play Flow Button (Sequential Step-by-Step Traversal) */}
        <button
          onClick={() => store.playFlow()}
          disabled={store.nodes.length === 0 || isPlayingFlow}
          title="Traverse diagram flow node-by-node"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            isPlayingFlow
              ? 'bg-[#f54e00]/10 text-[#f54e00]'
              : 'text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] disabled:opacity-40 disabled:hover:bg-transparent'
          }`}
        >
          <Play className={`w-3.5 h-3.5 ${isPlayingFlow ? 'text-[#f54e00] animate-pulse' : 'text-[#807d72]'}`} />
          <span className="hidden sm:inline">{isPlayingFlow ? 'Playing...' : 'Play Flow'}</span>
        </button>

        {/* Auto-Layout */}
        <button
          onClick={() => store.applyLayout()}
          disabled={store.nodes.length === 0}
          title="Auto-organize the whole layout (saved as a position update)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] disabled:opacity-40 text-xs font-medium transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-[#807d72]" />
          <span className="hidden sm:inline">Layout</span>
        </button>

        <div className="h-4 w-px bg-[#e6e5e0] mx-0.5" />

        {/* Delete */}
        <button
          onClick={handleDelete}
          disabled={store.nodes.length === 0}
          title="Delete selected nodes (Del / Backspace)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#cf2d56] hover:bg-[#cf2d56]/10 disabled:opacity-40 text-xs font-medium transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {selectedCount > 0 && (
            <span className="text-[10px] font-mono font-bold text-[#cf2d56]">{selectedCount}</span>
          )}
        </button>
      </div>

      {/* Manual Node Edit Modal */}
      {editingNodeId && (
        <NodeEditModal
          nodeId={editingNodeId}
          onClose={() => setEditingNodeId(null)}
        />
      )}
    </>
  );
};
