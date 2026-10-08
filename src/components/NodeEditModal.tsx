import React, { useState, useEffect } from 'react';
import { useDiagramStore } from '../diagram/store';
import { AWSIcon } from './icons/AWSIcons';
import { AWSServiceIcon, SystemNodeType } from '../types/diagram';
import { X, Check, Trash2, ArrowRight } from 'lucide-react';
import { groupByCategory, PALETTE, searchComponents } from '../shell/palette';

interface NodeEditModalProps {
  nodeId: string | null;
  onClose: () => void;
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
const DEFAULT_NAMES = new Set(PALETTE.flatMap((c) => [squash(c.label), squash(c.subType ?? ''), squash(c.awsIcon)]));
/** A name that only repeats a service's own name ("CloudFront CDN", "CloudFrontCDN"). Such a name follows the service when it is changed; a name the person chose ("Orders") never does. */
export const isServiceName = (name: string): boolean => DEFAULT_NAMES.has(squash(name));

export const NodeEditModal: React.FC<NodeEditModalProps> = ({ nodeId, onClose }) => {
  const store = useDiagramStore();
  const node = store.nodes.find((n) => n.id === nodeId);

  const [label, setLabel] = useState('');
  const [subType, setSubType] = useState('');
  const [selectedAwsIcon, setSelectedAwsIcon] = useState<AWSServiceIcon>('generic');
  const [selectedType, setSelectedType] = useState<SystemNodeType>('service');
  const [targetConnectId, setTargetConnectId] = useState<string>('');
  const [query, setQuery] = useState('');

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
    void store.editNode(nodeId, {
      label: label.trim() || node.data.label,
      subType: subType.trim(),
      awsIcon: selectedAwsIcon,
      type: selectedType,
      ...(node.data.description ? { description: node.data.description } : {}),
    });

    if (targetConnectId && targetConnectId !== nodeId) {
      void store.connect(nodeId, targetConnectId);
    }

    onClose();
  };

  const handleDelete = () => {
    void store.removeNode(nodeId);
    onClose();
  };

  const otherNodes = store.nodes.filter((n) => n.id !== nodeId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-lg bg-surface border border-line shadow-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <AWSIcon name={selectedAwsIcon} type={selectedType} size={22} />
            <div>
              <h3 className="text-sm font-semibold text-ink tracking-tight">Edit Component</h3>
              <p className="text-[11px] font-mono text-muted">{nodeId.slice(0, 8)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted hover:text-ink hover:bg-soft transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Label / Rename */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1.5">
              Component Name (Rename)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-md bg-soft border border-line focus:border-ink focus:bg-surface text-ink outline-none font-medium transition-all"
              placeholder="e.g. Auth Service"
            />
          </div>

          {/* Subtitle / Spec */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1.5">
              Service Subtype / Specification
            </label>
            <input
              type="text"
              value={subType}
              onChange={(e) => setSubType(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-md bg-soft border border-line focus:border-ink focus:bg-surface text-ink outline-none transition-all"
              placeholder="e.g. Amazon EC2 / Node.js 20"
            />
          </div>

          {/* AWS Service Picker */}
          <div>
            <label className="block text-xs font-medium text-ink mb-2">
              Select AWS Component
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or purpose, e.g. monitoring" aria-label="Search components" className="w-full mb-1.5 px-3 py-1.5 text-xs rounded-md bg-soft border border-line focus:border-ink text-ink outline-none" />
            <div className="max-h-56 overflow-y-auto p-1 border border-line rounded-md bg-soft">
              {(query.trim() ? [{ category: 'Matches', items: searchComponents(query) }] : groupByCategory(PALETTE)).map(({ category, items }) => (
                <div key={category}>
                  <div className="px-1.5 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{category}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((opt) => {
                      const isSelected = selectedAwsIcon === opt.awsIcon;
                      return (
                        <button
                          key={opt.awsIcon}
                          type="button"
                          onClick={() => {
                            // The name follows the service only while it is just the old service's name.
                            if (isServiceName(label)) setLabel(opt.label);
                            setSelectedAwsIcon(opt.awsIcon);
                            setSelectedType(opt.type);
                            if (!subType || isServiceName(subType) || subType === node.data.subType) setSubType(opt.subType ?? '');
                          }}
                          className={`flex items-center gap-2 p-2 rounded-md text-left text-xs transition-all ${isSelected ? 'bg-surface border border-primary shadow-xs text-ink font-medium' : 'hover:bg-surface border border-transparent text-body'}`}
                        >
                          <AWSIcon name={opt.awsIcon} type={opt.type} size={18} />
                          <span className="truncate">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Connect to Another Node */}
          {otherNodes.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1.5">
                Connect Outgoing Arrow To:
              </label>
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-muted flex-shrink-0" />
                <select
                  value={targetConnectId}
                  onChange={(e) => setTargetConnectId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md bg-soft border border-line text-ink outline-none"
                >
                  <option value="">-- No connection --</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-soft border-t border-line">
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-danger hover:bg-danger/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-body hover:text-ink hover:bg-surface border border-transparent hover:border-line transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-primary hover:bg-primary-hover text-white transition-all shadow-xs"
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
