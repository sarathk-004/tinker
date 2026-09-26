import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useConversationStore } from '../ai/conversationStore';
import { useDiagramStore } from '../diagram/store';
import {
  MessageSquare,
  Lightbulb,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Zap,
  User,
  PlusCircle,
  CheckCircle2,
  Volume2,
  Play,
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

export const SidebarPanel: React.FC = () => {
  const turns = useConversationStore((s) => s.turns);
  const clearTurns = useConversationStore((s) => s.clear);
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const store = useDiagramStore();

  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'advisor' | 'conversation'>('advisor');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll conversation to bottom
  useEffect(() => {
    if (scrollRef.current && isOpen && activeTab === 'conversation') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isOpen, activeTab]);

  // If user just submitted a prompt, switch to conversation tab
  useEffect(() => {
    if (turns.length > 0 && turns[turns.length - 1].role === 'user') {
      setActiveTab('conversation');
      setIsOpen(true);
    }
  }, [turns.length]);

  // Analyze the diagram for architecture suggestions
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
      (n) => n.data.type === 'storage' || n.id.includes('s3') || n.id.includes('storage')
    );
    const hasAuth = nodes.some(
      (n) => n.id.includes('auth') || n.id.includes('cognito') || (n.data.subType && n.data.subType.toLowerCase().includes('auth'))
    );
    const serviceNodes = nodes.filter((n) => n.data.type === 'service');

    // 1. Missing API Gateway
    if (hasClient && serviceNodes.length > 0 && !hasGateway) {
      list.push({
        id: 'missing-gateway',
        title: 'Exposing backend directly: Add API Gateway',
        category: 'Security',
        severity: 'high',
        reason:
          'Direct exposure of services introduces DDOS risks and lacks rate limiting. Add an API Gateway as the single reverse-proxy entry point.',
        actionLabel: 'Insert API Gateway',
        apply: () => {
          const clientNode = nodes.find((n) => n.data.type === 'client') || nodes[0];
          const firstService = serviceNodes[0];
          store.insertBetween(clientNode.id, firstService.id, {
            id: 'api_gateway',
            label: 'API Gateway',
            type: 'gateway',
            awsIcon: 'api-gateway',
            subType: 'Amazon API Gateway',
          });
          speakWithGeminiVoice('Inserted Amazon API Gateway to protect and rate-limit your backend services.');
        },
      });
    }

    // 2. High DB Load: Missing Redis Cache
    if (hasDatabase && !hasCache && serviceNodes.length > 0) {
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
              subType: 'ElastiCache / Redis',
            });
          } else {
            store.addNode({
              id: 'cache_redis',
              label: 'Redis Cache',
              type: 'cache',
              awsIcon: 'redis',
              subType: 'ElastiCache / Redis',
            });
            if (dbNode) store.connect('cache_redis', dbNode.id);
          }
          speakWithGeminiVoice('Added Redis Cache to absorb frequent database read spikes.');
        },
      });
    }

    // 3. Tightly Coupled Synchronous Services: Add SQS Queue
    if (serviceNodes.length >= 2 && !hasQueue) {
      list.push({
        id: 'missing-queue',
        title: 'Tight Coupling: Add SQS Message Queue',
        category: 'Decoupling',
        severity: 'medium',
        reason:
          'Synchronous HTTP calls between microservices create cascading failures. Decouple background tasks using an asynchronous queue.',
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

    // 4. Missing Object Storage
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
        title: 'Zero-Trust: Add Auth / Cognito',
        category: 'Security',
        severity: 'medium',
        reason:
          'Centralize JWT validation and identity management with AWS Cognito or an Auth microservice.',
        actionLabel: 'Add AWS Cognito',
        apply: () => {
          store.addNode({
            id: 'auth_cognito',
            label: 'AWS Cognito',
            type: 'service',
            awsIcon: 'cognito',
            subType: 'AWS Cognito (Auth)',
          });
          const gw = nodes.find((n) => n.data.type === 'gateway');
          if (gw) store.connect(gw.id, 'auth_cognito');
          speakWithGeminiVoice('Added AWS Cognito for centralized identity management.');
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
    <>
      {/* Toggle Bar when collapsed */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          title="Open Advisory & History Sidechat"
          className="fixed left-0 top-20 z-40 flex items-center gap-2 px-2.5 py-2 rounded-r-md bg-white border-y border-r border-[#e6e5e0] text-[#26251e] shadow-xs hover:bg-[#fafaf7] transition-all cursor-pointer select-none group"
        >
          <ChevronRight className="w-4 h-4 text-[#807d72] group-hover:text-[#26251e]" />
          <div className="flex items-center gap-1.5 text-xs font-mono font-medium">
            <Lightbulb className="w-3.5 h-3.5 text-[#f54e00]" />
            <span>Sidechat</span>
            {suggestions.length > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#f54e00]/15 text-[#f54e00]">
                {suggestions.length}
              </span>
            )}
          </div>
        </button>
      )}

      {/* Left Docked Sidechat Panel */}
      <aside
        className={`fixed left-0 top-14 bottom-0 z-40 flex flex-col bg-white border-r border-[#e6e5e0] shadow-sm transition-transform duration-200 select-none ${
          isOpen ? 'translate-x-0 w-84 sm:w-92' : '-translate-x-full w-0 overflow-hidden'
        }`}
      >
        {/* Panel Header & Tabs */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#e6e5e0] bg-[#fafaf7]">
          <div className="flex items-center gap-1">
            {/* Advisor Tab */}
            <button
              onClick={() => setActiveTab('advisor')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'advisor'
                  ? 'bg-white text-[#26251e] border border-[#e6e5e0] shadow-xs'
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
              onClick={() => setActiveTab('conversation')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'conversation'
                  ? 'bg-white text-[#26251e] border border-[#e6e5e0] shadow-xs'
                  : 'text-[#5a5852] hover:text-[#26251e]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#807d72]" />
              <span>History</span>
              {turns.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#e6e5e0] text-[#5a5852]">
                  {turns.length}
                </span>
              )}
            </button>
          </div>

          {/* Toggle Close Bar Button */}
          <button
            onClick={() => setIsOpen(false)}
            title="Collapse Sidebar"
            className="p-1.5 rounded-md text-[#807d72] hover:text-[#26251e] hover:bg-[#e6e5e0] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Global Flow Traversal Header Action */}
        {nodes.length > 0 && (
          <div className="px-3.5 py-2 bg-white border-b border-[#e6e5e0] flex items-center justify-between">
            <span className="text-[11px] font-mono text-[#807d72]">Live Flow Traversal</span>
            <button
              onClick={() => store.playFlow()}
              disabled={store.isPlayingFlow}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#fafaf7] hover:bg-[#e6e5e0] border border-[#e6e5e0] text-xs font-mono font-medium text-[#26251e] transition-all"
            >
              <Play className={`w-3 h-3 ${store.isPlayingFlow ? 'text-[#f54e00] animate-pulse' : 'text-[#f54e00]'}`} />
              <span>{store.isPlayingFlow ? 'Traversing...' : 'Show Flow'}</span>
            </button>
          </div>
        )}

        {/* Tab 1: Architecture Advisor */}
        {activeTab === 'advisor' && (
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {nodes.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#807d72] leading-relaxed">
                <Lightbulb className="w-6 h-6 text-[#cfcdc4] mx-auto mb-2" />
                Add AWS services or describe your system to receive real-time production recommendations.
              </div>
            ) : (
              <>
                {/* Readiness Score Bar */}
                <div className="p-3 rounded-md bg-[#fafaf7] border border-[#e6e5e0]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-mono text-[#807d72] uppercase tracking-wider">
                      Production Readiness
                    </span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        readinessScore >= 80
                          ? 'text-[#10b981]'
                          : readinessScore >= 50
                          ? 'text-[#f59e0b]'
                          : 'text-[#ef4444]'
                      }`}
                    >
                      {readinessScore}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[#e6e5e0] rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        readinessScore >= 80
                          ? 'bg-[#10b981]'
                          : readinessScore >= 50
                          ? 'bg-[#f59e0b]'
                          : 'bg-[#ef4444]'
                      }`}
                      style={{ width: `${readinessScore}%` }}
                    />
                  </div>
                </div>

                {/* Recommendations List */}
                <div className="space-y-2">
                  <div className="text-[11px] font-mono font-medium text-[#807d72] uppercase tracking-wider px-0.5">
                    Recommended Fixes ({suggestions.length})
                  </div>

                  {suggestions.length === 0 ? (
                    <div className="p-3 rounded-md bg-[#10b981]/10 border border-[#10b981]/20 flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#10b981] flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-medium text-[#26251e]">Well-Architected System</div>
                        <div className="text-[11px] text-[#5a5852] mt-0.5">
                          Gateway, caching, queuing, and storage are properly configured.
                        </div>
                      </div>
                    </div>
                  ) : (
                    suggestions.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-md bg-white border border-[#e6e5e0] hover:border-[#26251e]/40 transition-colors shadow-2xs"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold text-[#26251e] leading-snug">
                            {item.title}
                          </span>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${
                              item.severity === 'high'
                                ? 'bg-[#ef4444]/10 text-[#ef4444]'
                                : item.severity === 'medium'
                                ? 'bg-[#f59e0b]/10 text-[#f59e0b]'
                                : 'bg-[#10b981]/10 text-[#10b981]'
                            }`}
                          >
                            {item.category}
                          </span>
                        </div>

                        <p className="text-[11px] text-[#5a5852] leading-relaxed mb-2.5">
                          {item.reason}
                        </p>

                        <button
                          onClick={item.apply}
                          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#fafaf7] hover:bg-[#f54e00] hover:text-white border border-[#e6e5e0] hover:border-[#f54e00] text-xs font-medium text-[#26251e] transition-all"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          <span>{item.actionLabel}</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 2: Conversation & Architectural History */}
        {activeTab === 'conversation' && (
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-[#e6e5e0] bg-[#fafaf7]">
              <span className="text-[11px] font-mono text-[#807d72]">
                {turns.length} Turn{turns.length !== 1 ? 's' : ''}
              </span>
              {turns.length > 0 && (
                <button
                  onClick={clearTurns}
                  title="Clear history"
                  className="flex items-center gap-1 text-[11px] font-mono text-[#807d72] hover:text-[#cf2d56] transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {turns.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#807d72] leading-relaxed">
                  <MessageSquare className="w-6 h-6 text-[#cfcdc4] mx-auto mb-2" />
                  No messages yet. Ask questions or dictate architecture commands to see the interactive explanation history.
                </div>
              ) : (
                turns.map((turn, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col text-xs animate-fade-in ${
                      turn.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1 text-[10px] font-mono text-[#807d72]">
                      {turn.role === 'user' ? (
                        <>
                          <span>You</span>
                          <User className="w-3 h-3 text-[#5a5852]" />
                        </>
                      ) : (
                        <>
                          <Zap className="w-3 h-3 text-[#f54e00]" />
                          <span>Gemini Flash</span>
                        </>
                      )}
                    </div>

                    <div
                      className={`max-w-[92%] px-3 py-2 rounded-md leading-relaxed ${
                        turn.role === 'user'
                          ? 'bg-[#26251e] text-white rounded-br-none font-medium'
                          : 'bg-[#fafaf7] text-[#26251e] border border-[#e6e5e0] rounded-bl-none shadow-2xs'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{turn.text}</p>

                      {/* Action / Flow Inspection Button */}
                      {turn.role === 'assistant' && (
                        <div className="mt-2.5 pt-2 border-t border-[#e6e5e0] flex items-center justify-between gap-2">
                          <button
                            onClick={() => store.playFlow()}
                            title="Light up nodes sequentially one after the other"
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white hover:bg-[#e6e5e0] border border-[#e6e5e0] text-[10px] font-mono text-[#26251e] transition-all"
                          >
                            <Play className="w-2.5 h-2.5 text-[#f54e00]" />
                            <span>Show Flow</span>
                          </button>

                          <button
                            onClick={() => speakWithGeminiVoice(turn.text)}
                            title="Replay Gemini Audio"
                            className="p-1 rounded text-[#807d72] hover:text-[#26251e] hover:bg-[#e6e5e0] transition-colors"
                          >
                            <Volume2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
