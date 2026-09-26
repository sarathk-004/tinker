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

  // If there are turns and user just submitted a prompt, switch to conversation tab briefly
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
          'In production, clients should never call backend microservices directly. An API Gateway handles SSL, rate limiting, and route authentication.',
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
          'Direct database reads cause connection exhaustion during traffic spikes. Adding Redis absorbs 80%+ of read queries with sub-millisecond response times.',
        actionLabel: 'Insert Redis Cache',
        apply: () => {
          const dbNode = nodes.find(
            (n) => n.data.type === 'database' || n.id.includes('postgres') || n.id.includes('rds')
          );
          const upstream = edges.filter((e) => e.target === dbNode?.id).map((e) => e.source);
          if (upstream.length > 0 && dbNode) {
            store.insertBetween(upstream[0], dbNode.id, {
              id: 'redis',
              label: 'Redis Cache',
              type: 'cache',
              awsIcon: 'redis',
              subType: 'ElastiCache',
            });
          } else {
            store.addNode({
              id: 'redis',
              label: 'Redis Cache',
              type: 'cache',
              awsIcon: 'redis',
              subType: 'ElastiCache',
            });
            if (dbNode) store.connect('redis', dbNode.id);
          }
          speakWithGeminiVoice('Inserted Redis Cache to protect database from read spikes.');
        },
      });
    }

    // 3. Missing Asynchronous Queue
    if (nodes.length >= 3 && !hasQueue) {
      list.push({
        id: 'missing-queue',
        title: 'Coupled Services: Add SQS Queue',
        category: 'Decoupling',
        severity: 'medium',
        reason:
          'Synchronous HTTP calls between microservices lead to cascading timeouts. An SQS Queue buffers requests and decouples background tasks.',
        actionLabel: 'Add SQS Queue',
        apply: () => {
          store.addNode({
            id: 'orders_queue',
            label: 'SQS Queue',
            type: 'queue',
            awsIcon: 'sqs',
            subType: 'Amazon SQS',
          });
          const orders = nodes.find((n) => n.id.includes('orders') || n.data.label.toLowerCase().includes('order'));
          if (orders) {
            store.connect(orders.id, 'orders_queue', 'async events');
          }
          speakWithGeminiVoice('Added SQS Queue to decouple background asynchronous workflows.');
        },
      });
    }

    // 4. Missing Static Asset Storage
    if (hasClient && !hasStorage) {
      list.push({
        id: 'missing-storage',
        title: 'Static Media: Add S3 Storage',
        category: 'Performance',
        severity: 'low',
        reason:
          'Serving images, videos, and frontend assets from backend servers wastes compute. Offload static media to Amazon S3.',
        actionLabel: 'Add S3 Bucket',
        apply: () => {
          store.addNode({
            id: 'assets_s3',
            label: 'S3 Storage',
            type: 'storage',
            awsIcon: 's3',
            subType: 'Amazon S3',
          });
          speakWithGeminiVoice('Added Amazon S3 storage bucket for static media assets.');
        },
      });
    }

    // 5. Missing Authentication
    if (hasGateway && !hasAuth) {
      list.push({
        id: 'missing-auth',
        title: 'No Authentication: Add Auth Service',
        category: 'Security',
        severity: 'high',
        reason:
          'Production APIs require JWT or OAuth verification. Add an Auth Service or Cognito Authorizer.',
        actionLabel: 'Add Auth Service',
        apply: () => {
          store.addNode({
            id: 'auth',
            label: 'Auth Service',
            type: 'service',
            awsIcon: 'ec2',
            subType: 'Amazon EC2',
          });
          const gw = nodes.find((n) => n.data.type === 'gateway' || n.id.includes('gw'));
          if (gw) {
            store.connect(gw.id, 'auth', 'authorizes');
          }
          speakWithGeminiVoice('Added Auth Service for token validation.');
        },
      });
    }

    return list;
  }, [nodes, edges, store]);

  // Don't render panel if empty canvas and no conversation
  if (nodes.length === 0 && turns.length === 0) return null;

  const readinessScore = Math.max(30, 100 - suggestions.length * 15);

  return (
    <div className="absolute top-20 right-6 z-30 pointer-events-auto select-none">
      <div className="bg-[#001e2b]/95 backdrop-blur-xl border border-[#1c2d38] rounded-2xl shadow-2xl w-80 overflow-hidden">
        {/* Tab Headers - MongoDB Style */}
        <div className="flex items-center justify-between border-b border-[#1c2d38] bg-[#002636]/90 px-2 py-1.5">
          <div className="flex items-center gap-1">
            {/* Advisor Tab */}
            <button
              onClick={() => {
                setActiveTab('advisor');
                setIsExpanded(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'advisor'
                  ? 'bg-[#00ed64]/15 text-[#00ed64] border border-[#00ed64]/30 shadow-sm'
                  : 'text-[#a8b3bc] hover:text-white hover:bg-[#002636]'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5 text-[#00ed64]" />
              <span>Advisor</span>
              {suggestions.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  {suggestions.length}
                </span>
              )}
            </button>

            {/* Conversation Tab */}
            <button
              onClick={() => {
                setActiveTab('conversation');
                setIsExpanded(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'conversation'
                  ? 'bg-[#00ed64]/15 text-[#00ed64] border border-[#00ed64]/30 shadow-sm'
                  : 'text-[#a8b3bc] hover:text-white hover:bg-[#002636]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>History</span>
              {turns.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#001e2b] text-[#a8b3bc] border border-[#1c2d38]">
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
                className="p-1 rounded-full text-[#a8b3bc] hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Collapse' : 'Expand'}
              className="p-1 rounded-full text-[#a8b3bc] hover:text-white hover:bg-[#002636] transition-colors"
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
              <div className="p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[11px] font-semibold text-[#a8b3bc] uppercase tracking-wider">
                    Production Gaps
                  </span>
                  <span className="text-[10px] font-mono font-bold text-[#00ed64] bg-[#00ed64]/10 border border-[#00ed64]/25 px-2.5 py-0.5 rounded-full">
                    {readinessScore}% Ready
                  </span>
                </div>

                {suggestions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#00ed64] flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="w-6 h-6 text-[#00ed64]" />
                    <span className="font-semibold text-white">Architecture looks solid!</span>
                    <span className="text-[11px] text-[#a8b3bc]">
                      No critical architectural bottlenecks or missing layers detected.
                    </span>
                  </div>
                ) : (
                  suggestions.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-xl bg-[#002636]/60 border border-[#1c2d38] flex flex-col gap-1.5 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">
                          {item.title}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            item.category === 'Security'
                              ? 'bg-[#7b3ff2]/20 text-purple-300 border border-[#7b3ff2]/30'
                              : item.category === 'Performance'
                              ? 'bg-[#00ed64]/15 text-[#00ed64] border border-[#00ed64]/30'
                              : 'bg-[#fa6e39]/20 text-orange-300 border border-[#fa6e39]/30'
                          }`}
                        >
                          {item.category}
                        </span>
                      </div>

                      <p className="text-[11px] text-[#a8b3bc] leading-relaxed">
                        {item.reason}
                      </p>

                      <button
                        onClick={() => item.apply()}
                        className="mt-1 flex items-center justify-center gap-1.5 px-3 py-1 rounded-full bg-[#00ed64] hover:bg-[#00b545] text-[#001e2b] text-xs font-bold transition-all shadow-sm shadow-[#00ed64]/10"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>{item.actionLabel}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Conversation Tab Content */}
            {activeTab === 'conversation' && (
              <div ref={scrollRef} className="flex flex-col">
                {turns.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No conversation history yet. Speak or type instructions in the command bar!
                  </div>
                ) : (
                  turns.map((turn) => (
                    <div
                      key={turn.id}
                      className={`px-3 py-2 text-xs border-b border-slate-800/60 ${
                        turn.role === 'user' ? 'bg-slate-900/40' : 'bg-[#0d1018]/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {turn.role === 'user' ? (
                          <User className="w-3 h-3 text-sky-400" />
                        ) : (
                          <Zap className="w-3 h-3 text-amber-400" />
                        )}
                        <span
                          className={`font-semibold text-[10px] uppercase tracking-wider ${
                            turn.role === 'user' ? 'text-sky-400' : 'text-amber-400'
                          }`}
                        >
                          {turn.role === 'user' ? 'You' : 'tinker'}
                        </span>
                        {turn.source && (
                          <span className="text-[9px] font-mono text-slate-500 ml-auto">
                            {turn.source === 'gemini' ? 'Gemini' : 'Local'}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300 leading-relaxed break-words">
                        {turn.role === 'user' ? (
                          <span className="italic text-slate-400">"{turn.text}"</span>
                        ) : (
                          turn.text
                        )}
                      </p>
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
