import React from 'react';
import { useDiagramStore } from '../diagram/store';
import { Sparkles } from 'lucide-react';

export const DemoController: React.FC = () => {
  const store = useDiagramStore();

  // Golden Demo sequence turns from the PRD
  const runStep1 = () => {
    store.reset();
    store.addNode({ id: 'client', label: 'Web Client', type: 'client', awsIcon: 'client' });
    store.addNode({ id: 'api_gw', label: 'API Gateway', type: 'gateway', awsIcon: 'api-gateway' });
    store.addNode({ id: 'auth', label: 'Auth Service', type: 'service', awsIcon: 'ec2' });
    store.addNode({ id: 'orders', label: 'Orders Service', type: 'service', awsIcon: 'ec2' });

    store.connect('client', 'api_gw');
    store.connect('api_gw', 'auth');
    store.connect('api_gw', 'orders');
  };

  const runStep2 = () => {
    store.addNode({ id: 'postgres', label: 'PostgreSQL', type: 'database', awsIcon: 'rds', subType: 'Amazon RDS' });
    store.connect('orders', 'postgres');
  };

  const runStep3 = () => {
    store.insertBetween('orders', 'postgres', {
      id: 'redis',
      label: 'Redis Cache',
      type: 'cache',
      awsIcon: 'redis',
      subType: 'ElastiCache'
    });
  };

  const runStep4 = () => {
    store.removeNode('auth');
  };

  const runStep5 = () => {
    store.highlight(['orders', 'redis', 'postgres']);
  };

  return (
    <div className="absolute top-20 left-6 z-30 flex flex-col gap-2 pointer-events-auto">
      {/* Golden Demo Floating Panel */}
      <div className="bg-[#11141c]/90 backdrop-blur-xl border border-slate-800 rounded-xl p-3 shadow-2xl w-64 select-none">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200 uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Golden Demo Flow</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Phase 0</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <button
            onClick={runStep1}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800/80 transition-all text-left"
          >
            <span className="w-4 h-4 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold">1</span>
            <span className="truncate">Client → API → Auth, Orders</span>
          </button>

          <button
            onClick={runStep2}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800/80 transition-all text-left"
          >
            <span className="w-4 h-4 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">2</span>
            <span className="truncate">Orders → PostgreSQL</span>
          </button>

          <button
            onClick={runStep3}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800/80 transition-all text-left"
          >
            <span className="w-4 h-4 rounded bg-red-500/20 text-red-400 flex items-center justify-center text-[10px] font-bold">3</span>
            <span className="truncate">Insert Redis Between</span>
          </button>

          <button
            onClick={runStep4}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800/80 transition-all text-left"
          >
            <span className="w-4 h-4 rounded bg-slate-500/20 text-slate-400 flex items-center justify-center text-[10px] font-bold">4</span>
            <span className="truncate">Remove Auth</span>
          </button>

          <button
            onClick={runStep5}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800/80 transition-all text-left"
          >
            <span className="w-4 h-4 rounded bg-purple-500/20 text-purple-400 flex items-center justify-center text-[10px] font-bold">5</span>
            <span className="truncate">Highlight Orders Stack</span>
          </button>
        </div>

        {/* Quick actions row */}
        <div className="flex items-center gap-1 mt-2.5 pt-2 border-t border-slate-800">
          <button
            onClick={() => store.clearHighlight()}
            title="Clear Highlights"
            className="flex-1 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition-colors text-center"
          >
            Unhighlight
          </button>
          <button
            onClick={() => store.reset()}
            title="Clear all"
            className="px-2 py-1 text-[11px] font-medium text-rose-400 hover:text-rose-300 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/40 rounded transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};
