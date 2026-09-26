import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  const store = useDiagramStore();

  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'advisor' | 'conversation'>('advisor');
  
  // Resizable sidebar width (persisted in localStorage)
  const [width, setWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tinker_sidebar_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 250 && parsed <= 560) return parsed;
      }
    }
    return 310;
  });

  const isDraggingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resize drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newWidth = Math.max(250, Math.min(560, ev.clientX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setWidth((w) => {
          localStorage.setItem('tinker_sidebar_width', String(w));
          return w;
        });
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

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
      (n) =>
        n.id.includes('auth') ||
        n.id.includes('cognito') ||
        (n.data.subType && n.data.subType.toLowerCase().includes('auth'))
    );
    const serviceNodes = nodes.filter((n) => n.data.type === 'service');

    // 1. Missing API Gateway
    if (hasClient && serviceNodes.length > 0 && !hasGateway) {
      list.push({
        id: 'missing-gateway',
        title: 'Add API Gateway Ingress',
        category: 'Security',
        severity: 'high',
        reason:
          'Direct exposure of services introduces attack surfaces. Add an API Gateway as the single reverse-proxy entry point.',
        actionLabel: 'Insert API Gateway',
        apply: () => {
          const clientNode = nodes.find((n) => n.data.type === 'client') || nodes[0];
          const firstService = serviceNodes[0];
          store.insertBetween(clientNode.id, firstService.id, {
            label: 'API Gateway',
            type: 'gateway',
            awsIcon: 'api-gateway',
            subType: 'Amazon API Gateway',
          });
        },
      });
    }

    // 2. Missing Caching
    if (hasDatabase && serviceNodes.length > 0 && !hasCache) {
      list.push({
        id: 'missing-cache',
        title: 'Add ElastiCache / Redis Layer',
        category: 'Performance',
        severity: 'medium',
        reason:
          'Repeated read queries hit the relational database directly. Adding Redis reduces DB load and latency by 85%.',
        actionLabel: 'Add Redis Cache',
        apply: () => {
          const dbNode = nodes.find((n) => n.data.type === 'database');
          const svc = serviceNodes[0];
          if (dbNode && svc) {
            const cacheId = store.addNode({
              label: 'Redis Cache',
              type: 'cache',
              awsIcon: 'redis',
              subType: 'Amazon ElastiCache',
            });
            store.connect(svc.id, cacheId, 'reads (cache aside)');
          }
        },
      });
    }

    // 3. Decoupling with SQS
    if (serviceNodes.length >= 2 && !hasQueue) {
      list.push({
        id: 'missing-queue',
        title: 'Decouple Services with SQS',
        category: 'Decoupling',
        severity: 'medium',
        reason:
          'Synchronous HTTP chaining creates cascading failure risks. An asynchronous message queue provides durability.',
        actionLabel: 'Insert SQS Queue',
        apply: () => {
          if (serviceNodes.length >= 2) {
            store.insertBetween(serviceNodes[0].id, serviceNodes[1].id, {
              label: 'Task Queue',
              type: 'queue',
              awsIcon: 'sqs',
              subType: 'Amazon SQS',
            });
          }
        },
      });
    }

    // 4. Missing Object Storage
    if (!hasStorage && nodes.length >= 3) {
      list.push({
        id: 'missing-storage',
        title: 'Add S3 Object Storage',
        category: 'Reliability',
        severity: 'low',
        reason:
          'Assets and blob payloads should be offloaded to Amazon S3 to keep compute stateless.',
        actionLabel: 'Add S3 Bucket',
        apply: () => {
          const svc = serviceNodes[0] || nodes[0];
          const s3Id = store.addNode({
            label: 'S3 Storage',
            type: 'storage',
            awsIcon: 's3',
            subType: 'Amazon S3 Bucket',
          });
          store.connect(svc.id, s3Id, 'puts assets');
        },
      });
    }

    // 5. Missing Auth
    if (hasClient && !hasAuth) {
      list.push({
        id: 'missing-auth',
        title: 'Protect Routes with AWS Cognito',
        category: 'Security',
        severity: 'high',
        reason:
          'Unauthenticated endpoints risk unauthorized tenant data access. Integrate Cognito / JWT authorizer at ingress.',
        actionLabel: 'Add Cognito Auth',
        apply: () => {
          const gw = nodes.find((n) => n.data.type === 'gateway') || nodes[0];
          const authId = store.addNode({
            label: 'Cognito Auth',
            type: 'service',
            awsIcon: 'cognito',
            subType: 'AWS Cognito',
          });
          store.connect(gw.id, authId, 'validates JWT');
        },
      });
    }

    return list;
  }, [nodes, store]);

  // Production Readiness Score
  const readinessScore = useMemo(() => {
    if (nodes.length === 0) return 0;
    let score = 100;
    suggestions.forEach((s) => {
      if (s.severity === 'high') score -= 25;
      if (s.severity === 'medium') score -= 15;
      if (s.severity === 'low') score -= 5;
    });
    return Math.max(10, score);
  }, [nodes, suggestions]);

  return (
    <>
      {/* Docked button when collapsed */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          title="Open Advisory & Sidechat"
          className="absolute left-0 top-16 z-30 flex items-center gap-1.5 px-2 py-2 rounded-r-md bg-white border-y border-r border-[#e6e5e0] text-[#26251e] shadow-sm hover:bg-[#fafaf7] transition-all cursor-pointer group"
        >
          <ChevronRight className="w-4 h-4 text-[#807d72] group-hover:text-[#26251e]" />
          <div className="flex items-center gap-1 text-xs font-mono font-medium">
            <Lightbulb className="w-3.5 h-3.5 text-[#f54e00]" />
            <span>Chat</span>
            {suggestions.length > 0 && (
              <span className="text-[10px] font-mono px-1 py-0.2 rounded-full bg-[#f54e00]/15 text-[#f54e00]">
                {suggestions.length}
              </span>
            )}
          </div>
        </button>
      )}

      {/* In-flow non-overlapping left sidebar column */}
      <aside
        style={{ width: isOpen ? `${width}px` : '0px' }}
        className={`relative h-full flex flex-col bg-white border-r border-[#e6e5e0] select-none transition-[width] duration-150 ease-out flex-shrink-0 overflow-hidden ${
          !isOpen ? 'border-none' : ''
        }`}
      >
        {isOpen && (
          <div className="flex flex-col h-full w-full min-w-[240px]">
            {/* Panel Header & Tabs */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#e6e5e0] bg-[#fafaf7] flex-shrink-0">
              <div className="flex items-center gap-1">
                {/* Advisor Tab */}
                <button
                  onClick={() => setActiveTab('advisor')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    activeTab === 'advisor'
                      ? 'bg-white text-[#26251e] border border-[#e6e5e0] shadow-2xs'
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
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    activeTab === 'conversation'
                      ? 'bg-white text-[#26251e] border border-[#e6e5e0] shadow-2xs'
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

              {/* Close Button */}
              <button
                onClick={() => setIsOpen(false)}
                title="Collapse Sidebar"
                className="p-1 rounded-md text-[#807d72] hover:text-[#26251e] hover:bg-[#e6e5e0] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Flow Action Bar */}
            {nodes.length > 0 && (
              <div className="px-3 py-1.5 bg-white border-b border-[#e6e5e0] flex items-center justify-between flex-shrink-0">
                <span className="text-[10px] font-mono text-[#807d72]">Logical Flow</span>
                <button
                  onClick={() => store.playFlow()}
                  disabled={store.isPlayingFlow}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#fafaf7] hover:bg-[#e6e5e0] border border-[#e6e5e0] text-[11px] font-mono text-[#26251e] transition-all disabled:opacity-50"
                  title="Run sequential architectural packet traversal"
                >
                  <Play className={`w-3 h-3 text-[#f54e00] ${store.isPlayingFlow ? 'animate-spin' : ''}`} />
                  <span>{store.isPlayingFlow ? 'Running...' : 'Play Flow'}</span>
                </button>
              </div>
            )}

            {/* Tab 1: Architecture Advisor */}
            {activeTab === 'advisor' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {nodes.length === 0 ? (
                  <div className="text-center py-8 text-[#807d72]">
                    <Lightbulb className="w-7 h-7 mx-auto mb-2 text-[#a09c92]" />
                    <p className="text-xs">Add nodes to receive real-time Well-Architected suggestions.</p>
                  </div>
                ) : (
                  <>
                    {/* Architecture Readiness Card */}
                    <div className="p-2.5 rounded-md bg-[#fafaf7] border border-[#e6e5e0]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-medium text-[#26251e]">Production Readiness</span>
                        <span
                          className={`text-xs font-mono font-semibold ${
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
                          className={`h-full transition-all duration-300 rounded-full ${
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
                      <div className="text-[10px] font-mono font-medium text-[#807d72] uppercase tracking-wider px-0.5">
                        Recommendations ({suggestions.length})
                      </div>

                      {suggestions.length === 0 ? (
                        <div className="p-2.5 rounded-md bg-[#10b981]/10 border border-[#10b981]/20 flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#10b981] flex-shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-medium text-[#26251e]">Well-Architected</div>
                            <div className="text-[11px] text-[#5a5852] mt-0.5">
                              Core gateway, caching, and storage best practices are satisfied.
                            </div>
                          </div>
                        </div>
                      ) : (
                        suggestions.map((item) => (
                          <div
                            key={item.id}
                            className="p-2.5 rounded-md bg-white border border-[#e6e5e0] hover:border-[#26251e]/40 transition-colors shadow-2xs"
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="text-xs font-semibold text-[#26251e] leading-snug">
                                {item.title}
                              </span>
                              <span
                                className={`text-[9px] font-mono px-1 py-0.2 rounded-full flex-shrink-0 font-medium ${
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

                            <p className="text-[11px] text-[#5a5852] leading-relaxed mb-2">
                              {item.reason}
                            </p>

                            <button
                              onClick={item.apply}
                              className="w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-md bg-[#fafaf7] hover:bg-[#f54e00] hover:text-white border border-[#e6e5e0] hover:border-[#f54e00] text-[11px] font-medium text-[#26251e] transition-all"
                            >
                              <PlusCircle className="w-3 h-3" />
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
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#e6e5e0] bg-[#fafaf7] flex-shrink-0">
                  <span className="text-[10px] font-mono text-[#807d72]">
                    {turns.length} Turn{turns.length !== 1 ? 's' : ''}
                  </span>
                  {turns.length > 0 && (
                    <button
                      onClick={clearTurns}
                      title="Clear history"
                      className="flex items-center gap-1 text-[10px] font-mono text-[#807d72] hover:text-[#cf2d56] transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                  {turns.length === 0 ? (
                    <div className="text-center py-12 text-[#807d72]">
                      <MessageSquare className="w-7 h-7 mx-auto mb-2 text-[#a09c92]" />
                      <p className="text-xs">No conversation history yet.</p>
                      <p className="text-[11px] text-[#a09c92] mt-1">
                        Use the mic or command bar to build and ask questions.
                      </p>
                    </div>
                  ) : (
                    turns.map((turn, i) => (
                      <div
                        key={i}
                        className={`p-2.5 rounded-md border text-xs leading-relaxed ${
                          turn.role === 'user'
                            ? 'bg-[#fafaf7] border-[#e6e5e0] text-[#26251e]'
                            : 'bg-white border-[#e6e5e0] text-[#26251e] shadow-2xs'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#807d72]">
                            {turn.role === 'user' ? (
                              <>
                                <User className="w-3 h-3 text-[#5a5852]" />
                                <span>You</span>
                              </>
                            ) : (
                              <>
                                <Zap className="w-3 h-3 text-[#f54e00]" />
                                <span>Gemini Architect</span>
                              </>
                            )}
                          </span>

                          {turn.role === 'assistant' && (
                            <button
                              onClick={() => speakWithGeminiVoice(turn.text)}
                              title="Listen to response"
                              className="text-[#807d72] hover:text-[#f54e00] p-0.5 rounded transition-colors"
                            >
                              <Volume2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        <div className="text-[11.5px] text-[#26251e] whitespace-pre-wrap leading-relaxed">
                          {turn.text}
                        </div>

                        {turn.actions && turn.actions.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-[#e6e5e0]/60 space-y-0.5">
                            {turn.actions.map((act, actIdx) => (
                              <div
                                key={actIdx}
                                className="font-mono text-[10px] text-[#5a5852] flex items-center gap-1"
                              >
                                <span className="text-[#f54e00]">›</span>
                                <span>{act}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Drag handle on right edge */}
        {isOpen && (
          <div
            onMouseDown={handleMouseDown}
            title="Drag to resize sidebar"
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#f54e00]/50 active:bg-[#f54e00] transition-colors z-50 group"
          >
            <div className="w-0.5 h-8 bg-[#807d72]/30 group-hover:bg-[#f54e00] rounded-full mx-auto my-auto relative top-1/2 -translate-y-1/2" />
          </div>
        )}
      </aside>
    </>
  );
};
