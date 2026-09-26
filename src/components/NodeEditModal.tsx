import React, { useState, useEffect } from 'react';
import { useDiagramStore } from '../diagram/store';
import { AWSIcon } from './icons/AWSIcons';
import { AWSServiceIcon, SystemNodeType } from '../types/diagram';
import { X, Check, Trash2, ArrowRight } from 'lucide-react';

interface NodeEditModalProps {
  nodeId: string | null;
  onClose: () => void;
}

const AWS_OPTIONS: Array<{
  label: string;
  type: SystemNodeType;
  icon: AWSServiceIcon;
  subType: string;
}> = [
  { label: 'API Gateway', type: 'gateway', icon: 'api-gateway', subType: 'Amazon API Gateway' },
  { label: 'App Load Balancer', type: 'gateway', icon: 'alb', subType: 'Application Load Balancer' },
  { label: 'CloudFront CDN', type: 'gateway', icon: 'cloudfront', subType: 'Amazon CloudFront' },
  { label: 'Route 53 DNS', type: 'gateway', icon: 'route53', subType: 'Amazon Route 53' },
  { label: 'AWS WAF', type: 'gateway', icon: 'waf', subType: 'AWS WAF' },
  { label: 'EC2 Microservice', type: 'service', icon: 'ec2', subType: 'Amazon EC2' },
  { label: 'AWS Lambda', type: 'service', icon: 'lambda', subType: 'AWS Lambda' },
  { label: 'Amazon EKS', type: 'service', icon: 'eks', subType: 'Amazon EKS (Kubernetes)' },
  { label: 'AWS Cognito', type: 'service', icon: 'cognito', subType: 'AWS Cognito (Auth)' },
  { label: 'Step Functions', type: 'service', icon: 'step-functions', subType: 'AWS Step Functions' },
  { label: 'Amazon RDS', type: 'database', icon: 'rds', subType: 'Amazon RDS (PostgreSQL)' },
  { label: 'DynamoDB', type: 'database', icon: 'dynamodb', subType: 'Amazon DynamoDB' },
  { label: 'OpenSearch', type: 'database', icon: 'opensearch', subType: 'Amazon OpenSearch' },
  { label: 'Redis Cache', type: 'cache', icon: 'redis', subType: 'ElastiCache / Redis' },
  { label: 'Amazon SQS', type: 'queue', icon: 'sqs', subType: 'Amazon SQS' },
  { label: 'Amazon SNS', type: 'queue', icon: 'sns', subType: 'Amazon SNS' },
  { label: 'EventBridge', type: 'queue', icon: 'eventbridge', subType: 'Amazon EventBridge' },
  { label: 'Amazon Kinesis', type: 'queue', icon: 'kinesis', subType: 'Amazon Kinesis' },
  { label: 'Amazon S3', type: 'storage', icon: 's3', subType: 'Amazon S3' },
  { label: 'Secrets Manager', type: 'service', icon: 'secrets-manager', subType: 'AWS Secrets Manager' },
  { label: 'Web / Mobile Client', type: 'client', icon: 'client', subType: 'Client Application' },
];

export const NodeEditModal: React.FC<NodeEditModalProps> = ({ nodeId, onClose }) => {
  const store = useDiagramStore();
  const node = store.nodes.find((n) => n.id === nodeId);

  const [label, setLabel] = useState('');
  const [subType, setSubType] = useState('');
  const [selectedAwsIcon, setSelectedAwsIcon] = useState<AWSServiceIcon>('generic');
  const [selectedType, setSelectedType] = useState<SystemNodeType>('service');
  const [targetConnectId, setTargetConnectId] = useState<string>('');

  useEffect(() => {
    if (node) {
      setLabel(node.data.label);
      setSubType(node.data.subType || '');
      setSelectedAwsIcon(node.data.awsIcon || 'generic');
      setSelectedType(node.data.type || 'service');
    }
  }, [node]);

  if (!nodeId || !node) return null;

  const handleSave = () => {
    store.updateNode(nodeId, {
      label: label.trim() || node.data.label,
      subType: subType.trim() || undefined,
      awsIcon: selectedAwsIcon,
      type: selectedType,
    });

    if (targetConnectId && targetConnectId !== nodeId) {
      store.connect(nodeId, targetConnectId);
    }

    onClose();
  };

  const handleDelete = () => {
    store.removeNode(nodeId);
    onClose();
  };

  const otherNodes = store.nodes.filter((n) => n.id !== nodeId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-lg bg-white border border-[#e6e5e0] shadow-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e6e5e0]">
          <div className="flex items-center gap-2.5">
            <AWSIcon name={selectedAwsIcon} type={selectedType} size={22} />
            <div>
              <h3 className="text-sm font-semibold text-[#26251e] tracking-tight">Edit Component</h3>
              <p className="text-[11px] font-mono text-[#807d72]">{nodeId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#807d72] hover:text-[#26251e] hover:bg-[#fafaf7] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Label / Rename */}
          <div>
            <label className="block text-xs font-medium text-[#26251e] mb-1.5">
              Component Name (Rename)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-md bg-[#fafaf7] border border-[#e6e5e0] focus:border-[#26251e] focus:bg-white text-[#26251e] outline-none font-medium transition-all"
              placeholder="e.g. Auth Service"
            />
          </div>

          {/* Subtitle / Spec */}
          <div>
            <label className="block text-xs font-medium text-[#26251e] mb-1.5">
              Service Subtype / Specification
            </label>
            <input
              type="text"
              value={subType}
              onChange={(e) => setSubType(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-md bg-[#fafaf7] border border-[#e6e5e0] focus:border-[#26251e] focus:bg-white text-[#26251e] outline-none transition-all"
              placeholder="e.g. Amazon EC2 / Node.js 20"
            />
          </div>

          {/* AWS Service Picker */}
          <div>
            <label className="block text-xs font-medium text-[#26251e] mb-2">
              Select AWS Component
            </label>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto p-1 border border-[#e6e5e0] rounded-md bg-[#fafaf7]">
              {AWS_OPTIONS.map((opt) => {
                const isSelected = selectedAwsIcon === opt.icon;
                return (
                  <button
                    key={opt.icon}
                    type="button"
                    onClick={() => {
                      setSelectedAwsIcon(opt.icon);
                      setSelectedType(opt.type);
                      if (!subType || subType === node.data.subType) {
                        setSubType(opt.subType);
                      }
                    }}
                    className={`flex items-center gap-2 p-2 rounded-md text-left text-xs transition-all ${
                      isSelected
                        ? 'bg-white border border-[#f54e00] shadow-xs text-[#26251e] font-medium'
                        : 'hover:bg-white border border-transparent text-[#5a5852]'
                    }`}
                  >
                    <AWSIcon name={opt.icon} type={opt.type} size={18} />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Connect to Another Node */}
          {otherNodes.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[#26251e] mb-1.5">
                Connect Outgoing Arrow To:
              </label>
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-[#807d72] flex-shrink-0" />
                <select
                  value={targetConnectId}
                  onChange={(e) => setTargetConnectId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md bg-[#fafaf7] border border-[#e6e5e0] text-[#26251e] outline-none"
                >
                  <option value="">-- No connection --</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.label} ({n.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#fafaf7] border-t border-[#e6e5e0]">
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#cf2d56] hover:bg-[#cf2d56]/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-[#5a5852] hover:text-[#26251e] hover:bg-white border border-transparent hover:border-[#e6e5e0] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-[#f54e00] hover:bg-[#d04200] text-white transition-all shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
