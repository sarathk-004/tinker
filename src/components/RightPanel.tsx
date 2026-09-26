import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useConversationStore } from '../ai/conversationStore';
import { useDiagramStore } from '../diagram/store';
import {
  MessageSquare,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Trash2,
  Zap,
  User,
  PlusCircle,
  CheckCircle2,
  Volume2,
} from 'lucide-react';
import { speakWithGeminiVoice } from '../ai/geminiVoice';

interface Suggestion {
  id: string;
  title: string;
  category: 'Security' | 'Performance' | 'Reliability' | 'Decoupling';
  reason: string;
  actionLabel: string;
  severity: 'high' | 'medium' | 'low';
  apply: () => void;
}

export const RightPanel: React.FC = () => {
  const turns = useConversationStore((s) => s.turns);
  const clearTurns = useConversationStore((s) => s.clear);
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const store = useDiagramStore();

  const [activeTab, setActiveTab] = useState<'advisor' | 'conversation'>('advisor');
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll conversation to bottom
  useEffect(() => {
    if (scrollRef.current && isExpanded && activeTab === 'conversation') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isExpanded, activeTab]);

  // If there are turns and user just submitted a prompt, switch to conversation tab
  useEffect(() => {
    if (turns.length > 0 && turns[turns.length - 1].role === 'user') {
      setActiveTab('conversation');
    }
  }, [turns.length]);

  // Analyze the current diagram for missing production architecture components
  const suggestions = useMemo(() => {
    const list: Suggestion[] = [];
    if (nodes.length === 0) return list;

    const hasClient = nodes.some((n) => n.data.type === 'client' || n.id.includes('client'));
    const hasGateway = nodes.some(
      (n) => n.data.type === 'gateway' || n.id.includes('gateway') || n.id.includes('alb')
    );
    const hasDatabase = nodes.some(
      (n) => n.data.type === 'database' || n.id.includes('postgres') || n.id.includes('rds')
    );
    const hasCache = nodes.some(
      (n) => n.data.type === 'cache' || n.id.includes('redis') || n.id.includes('cache')
    );
    const hasQueue = nodes.some(
      (n) => n.data.type === 'queue' || n.id.includes('sqs') || n.id.includes('queue')
    );
    const hasStorage = nodes.some(
      (n) => n.data.type === 'storage' || n.id.includes('s3')
    );
    const hasAuth = nodes.some(
      (n) => n.id.includes('auth') || n.data.label.toLowerCase().includes('auth')
    );

    // 1. Missing API Gateway
    if (hasClient && !hasGateway) {
      list.push({
        id: 'missing-gateway',
        title: 'Missing API Gateway / Ingress',
        category: 'Security',
        severity: 'high',
        reason:
          'Clients should never connect directly to internal microservices. An API Gateway provides TLS termination, rate limiting, and unified routing.',
        actionLabel: 'Add API Gateway',
        apply: () => {
          const clientNode = nodes.find((n) => n.data.type === 'client' || n.id.includes('client'));
          const serviceNodes = nodes.filter(
            (n) => n.data.type === 'service' || !['client', 'database', 'cache'].includes(n.data.type)
          );
          store.addNode({
            id: 'api_gw',
            label: 'API Gateway',
            type: 'gateway',
            awsIcon: 'api-gateway',
            subType: 'Amazon API Gateway',
          });
          if (clientNode) {
            store.connect(clientNode.id, 'api_gw');
          }
          serviceNodes.forEach((svc) => {
            store.connect('api_gw', svc.id);
          });
          speakWithGeminiVoice('Added API Gateway to manage client ingress and security.');
        },
      });
    }

    // 2. Missing Cache layer before Database
    if (hasDatabase && !hasCache) {
      list.push({
        id: 'missing-cache',
        title: 'High DB Load: Add Redis Cache',
        category: 'Performance',
        severity: 'high',
        reason:
          'Direct database reads cause connection exhaustion during spikes. Redis absorbs 80%+ of frequent queries with sub-millisecond latency.',
        actionLabel: 'Insert Redis Cache',
        apply: () => {
          const dbNode = nodes.find((n) => n.data.type === 'database');
          const callerEdge = edges.find((e) => dbNode && e.target === dbNode.id);

          if (callerEdge && dbNode) {
            store.insertBetween(callerEdge.source, dbNode.id, {
              id: 'cache_redis',
              label: 'Redis Cache',
              type: 'cache',
              awsIcon: 'redis',
              subType: 'ElastiCache',
            });
          } else {
            store.addNode({
              id: 'cache_redis',
              label: 'Redis Cache',
              type: 'cache',
              awsIcon: 'redis',
              subType: 'ElastiCache',
            });
            if (dbNode) store.connect('cache_redis', dbNode.id);
          }
          speakWithGeminiVoice('Inserted Redis Cache to reduce primary database query load.');
        },
      });
    }

    // 3. Synchronous communication bottleneck: SQS Queue
    const serviceNodes = nodes.filter((n) => n.data.type === 'service');
    if (serviceNodes.length >= 2 && !hasQueue) {
      list.push({
        id: 'missing-queue',
        title: 'Tight Coupling: Add SQS Queue',
        category: 'Decoupling',
        severity: 'medium',
        reason:
          'Synchronous HTTP calls between microservices create cascading failures. An SQS queue buffers traffic and guarantees delivery.',
        actionLabel: 'Add SQS Queue',
        apply: () => {
          store.addNode({
            id: 'orders_queue',
            label: 'Orders Queue',
            type: 'queue',
            awsIcon: 'sqs',
            subType: 'Amazon SQS',
          });
          if (serviceNodes.length >= 2) {
            store.insertBetween(
              serviceNodes[0].id,
              serviceNodes[1].id,
              {
                id: 'orders_queue',
                label: 'Orders Queue',
                type: 'queue',
                awsIcon: 'sqs',
                subType: 'Amazon SQS',
              }
            );
          }
          speakWithGeminiVoice('Added SQS Queue to decouple microservices and buffer requests.');
        },
      });
    }

    // 4. Missing Object Storage for unstructured assets
    if (!hasStorage && nodes.length >= 3) {
      list.push({
        id: 'missing-s3',
        title: 'Static & Media Storage: Add S3',
        category: 'Reliability',
        severity: 'low',
        reason:
          'Microservices should offload file uploads, logs, and backups to Amazon S3 for 99.999999999% durability.',
        actionLabel: 'Attach S3 Bucket',
        apply: () => {
          store.addNode({
            id: 's3_assets',
            label: 'S3 Asset Bucket',
            type: 'storage',
            awsIcon: 's3',
            subType: 'Amazon S3',
          });
          const target = serviceNodes[0] || nodes[0];
          if (target) store.connect(target.id, 's3_assets');
          speakWithGeminiVoice('Attached Amazon S3 bucket for durable asset storage.');
        },
      });
    }

    // 5. Missing Dedicated Auth Service
    if (serviceNodes.length >= 2 && !hasAuth) {
      list.push({
        id: 'missing-auth',
        title: 'Zero-Trust: Add Auth Service',
        category: 'Security',
        severity: 'medium',
        reason:
          'Separate JWT validation and identity management into an Auth microservice rather than repeating logic.',
        actionLabel: 'Add Auth Service',
        apply: () => {
          store.addNode({
            id: 'svc_auth',
            label: 'Auth Service',
            type: 'service',
            awsIcon: 'ec2',
            subType: 'Amazon EC2',
          });
          const gw = nodes.find((n) => n.data.type === 'gateway');
          if (gw) store.connect(gw.id, 'svc_auth');
          speakWithGeminiVoice('Added Auth Service for centralized authentication.');
        },
      });
    }

    return list;
  }, [nodes, edges, store]);

  // Overall system readiness score calculation
  const readinessScore = useMemo(() => {
    if (nodes.length === 0) return 0;
    let score = 100;
    suggestions.forEach((s) => {
      if (s.severity === 'high') score -= 25;
      else if (s.severity === 'medium') score -= 15;
      else score -= 10;
    });
    return Math.max(10, score);
  }, [nodes, suggestions]);

  return (
    <div className="absolute top-16 right-6 z-30 w-80 select-none animate-fade-in font-sans">
      <div className="rounded-md bg-white border border-[#e6e5e0] overflow-hidden">
        {/* Panel Header & Tabs */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#e6e5e0] bg-[#fafaf7]">
          <div className="flex items-center gap-1">
            {/* Advisor Tab */}
            <button
              onClick={() => {
                setActiveTab('advisor');
                setIsExpanded(true);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'advisor'
                  ? 'bg-white text-[#26251e] border border-[#e6e5e0]'
                  : 'text-[#5a5852] hover:text-[#26251e]'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5 text-[#f54e00]" />
              <span>Advisor</span>
              {suggestions.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#f54e00]/15 text-[#f54e00]">
                  {suggestions.length}
                </span>
              )}
            </button>

            {/* History Tab */}
            <button
              onClick={() => {
                setActiveTab('conversation');
                setIsExpanded(true);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'conversation'
                  ? 'bg-white text-[#26251e] border border-[#e6e5e0]'
                  : 'text-[#5a5852] hover:text-[#26251e]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#5a5852]" />
              <span>History</span>
              {turns.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#e6e5e0] text-[#26251e]">
                  {turns.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-1">
            {activeTab === 'conversation' && turns.length > 0 && (
              <button
                onClick={() => clearTurns()}
                title="Clear conversation"
                className="p-1 rounded-md text-[#807d72] hover:text-[#cf2d56] hover:bg-[#fafaf7] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Collapse' : 'Expand'}
              className="p-1 rounded-md text-[#807d72] hover:text-[#26251e] hover:bg-[#fafaf7] transition-colors"
            >
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Panel Body */}
        {isExpanded && (
          <div className="max-h-80 overflow-y-auto">
            {/* Advisor Tab Content */}
            {activeTab === 'advisor' && (
              <div className="p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[11px] font-mono font-medium text-[#807d72] uppercase tracking-wider">
                    Production Readiness
                  </span>
                  <span className="text-[11px] font-mono font-medium text-[#26251e] bg-[#e6e5e0] px-2 py-0.5 rounded-full">
                    {readinessScore}%
                  </span>
                </div>

                {suggestions.length === 0 ? (
                  <div className="p-4 text-center text-xs flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="w-6 h-6 text-[#1f8a65]" />
                    <span className="font-medium text-[#26251e]">Architecture looks solid!</span>
                    <span className="text-[11px] text-[#5a5852]">
                      No critical architecture bottlenecks or missing layers detected.
                    </span>
                  </div>
                ) : (
                  suggestions.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-md bg-[#fafaf7] border border-[#e6e5e0] flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#26251e]">
                          {item.title}
                        </span>
                        <span
                          className={`text-[9px] font-mono font-medium uppercase px-2 py-0.5 rounded-full ${
                            item.category === 'Security'
                              ? 'bg-[#dfa88f]/30 text-[#26251e] border border-[#dfa88f]/60'
                              : item.category === 'Performance'
                              ? 'bg-[#9fc9a2]/30 text-[#26251e] border border-[#9fc9a2]/60'
                              : 'bg-[#c08532]/25 text-[#26251e] border border-[#c08532]/60'
                          }`}
                        >
                          {item.category}
                        </span>
                      </div>

                      <p className="text-[11px] text-[#5a5852] leading-relaxed">
                        {item.reason}
                      </p>

                      <button
                        onClick={() => item.apply()}
                        className="mt-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-[#f54e00] hover:bg-[#d04200] text-white text-xs font-medium transition-all"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>{item.actionLabel}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Conversation / History Tab Content */}
            {activeTab === 'conversation' && (
              <div ref={scrollRef} className="flex flex-col">
                {turns.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#807d72]">
                    No conversation history yet. Speak or type instructions in the command bar!
                  </div>
                ) : (
                  turns.map((turn) => (
                    <div
                      key={turn.id}
                      className={`px-3 py-2.5 text-xs border-b border-[#e6e5e0] ${
                        turn.role === 'user' ? 'bg-[#fafaf7]' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {turn.role === 'user' ? (
                          <User className="w-3 h-3 text-[#5a5852]" />
                        ) : (
                          <Zap className="w-3 h-3 text-[#f54e00]" />
                        )}
                        <span
                          className={`font-medium text-[11px] ${
                            turn.role === 'user' ? 'text-[#5a5852]' : 'text-[#f54e00]'
                          }`}
                        >
                          {turn.role === 'user' ? 'You' : 'tinker'}
                        </span>
                        {turn.source && (
                          <span className="text-[9px] font-mono text-[#807d72] ml-auto">
                            {turn.source === 'gemini' ? 'Gemini 3.8 Flash' : 'Local'}
                          </span>
                        )}
                      </div>
                      <p className="text-[#26251e] leading-relaxed break-words font-sans">
                        {turn.role === 'user' ? (
                          <span className="italic text-[#5a5852]">"{turn.text}"</span>
                        ) : (
                          turn.text
                        )}
                      </p>
                      {turn.role === 'assistant' && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            onClick={() => speakWithGeminiVoice(turn.text)}
                            className="text-[10px] text-[#5a5852] hover:text-[#f54e00] flex items-center gap-1 transition-colors font-mono"
                          >
                            <Volume2 className="w-3 h-3" /> Replay Voice
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
