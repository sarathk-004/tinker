import { useMemo } from 'react';
import { useDiagramStore } from '../diagram/store';
import type { NewNodeSpec } from '../diagram/adapters';

export interface Suggestion {
  id: string;
  title: string;
  category: 'Security' | 'Performance' | 'Reliability' | 'Decoupling';
  reason: string;
  actionLabel: string;
  severity: 'high' | 'medium' | 'low';
  apply: () => void;
}

/** Points a suggestion costs the "production readiness" score. */
const COST = { high: 25, medium: 15, low: 5 } as const;

/**
 * Architecture advice computed from the diagram itself (no model, no network): what a production system of this shape usually has
 * that this one lacks. Every suggestion is a sequence of ordinary diagram commands, so applying one is a normal, undoable edit.
 */
export function useAdvisor(): { suggestions: Suggestion[]; readiness: number; empty: boolean; count: number } {
  const nodes = useDiagramStore((s) => s.nodes);

  return useMemo(() => {
    const store = useDiagramStore.getState();
    // The server assigns node ids, so each step waits for the previous one.
    const insertOrWire = async (source: string, target: string, spec: NewNodeSpec) => {
      if (store.edges.some((e) => e.source === source && e.target === target)) {
        await store.insertBetween(source, target, spec); // one atomic INSERT_BETWEEN
        return;
      }
      const id = await store.addNode(spec); // no connection to split: add the node and wire it in
      if (!id) return;
      await store.connect(source, id);
      await store.connect(id, target);
    };
    const addAndConnect = async (from: string, spec: NewNodeSpec, label: string) => {
      const id = await store.addNode(spec);
      if (id) await store.connect(from, id, label);
    };

    const list: Suggestion[] = [];
    if (nodes.length > 0) {
      const label = (n: (typeof nodes)[number]) => n.data.label.toLowerCase();
      const any = (pred: (n: (typeof nodes)[number]) => boolean) => nodes.some(pred);
      const hasClient = any((n) => n.data.type === 'client' || label(n).includes('client'));
      const hasGateway = any((n) => n.data.type === 'gateway' || label(n).includes('gateway') || label(n).includes('alb'));
      const hasDatabase = any((n) => n.data.type === 'database' || label(n).includes('postgres') || label(n).includes('rds'));
      const hasCache = any((n) => n.data.type === 'cache' || label(n).includes('redis') || label(n).includes('cache'));
      const hasQueue = any((n) => n.data.type === 'queue' || label(n).includes('sqs') || label(n).includes('queue'));
      const hasStorage = any((n) => n.data.type === 'storage' || label(n).includes('s3') || label(n).includes('storage'));
      const hasAuth = any((n) => label(n).includes('auth') || label(n).includes('cognito') || !!n.data.subType?.toLowerCase().includes('auth'));
      const serviceNodes = nodes.filter((n) => n.data.type === 'service');

      if (hasClient && serviceNodes.length > 0 && !hasGateway) {
        list.push({
          id: 'missing-gateway',
          title: 'Add an API gateway at the entrance',
          category: 'Security',
          severity: 'high',
          reason: 'Clients talk to services directly, which widens the attack surface. A gateway gives one entry point for auth and rate limiting.',
          actionLabel: 'Insert API Gateway',
          apply: () => {
            const client = nodes.find((n) => n.data.type === 'client') ?? nodes[0]!;
            void insertOrWire(client.id, serviceNodes[0]!.id, { label: 'API Gateway', type: 'gateway', awsIcon: 'api-gateway', subType: 'Amazon API Gateway' });
          },
        });
      }
      if (hasDatabase && serviceNodes.length > 0 && !hasCache) {
        list.push({
          id: 'missing-cache',
          title: 'Add a cache in front of reads',
          category: 'Performance',
          severity: 'medium',
          reason: 'Repeated reads hit the database directly. A cache such as Redis takes most of that load and cuts latency.',
          actionLabel: 'Add Redis cache',
          apply: () => void addAndConnect(serviceNodes[0]!.id, { label: 'Redis Cache', type: 'cache', awsIcon: 'redis', subType: 'Amazon ElastiCache' }, 'reads (cache aside)'),
        });
      }
      if (serviceNodes.length >= 2 && !hasQueue) {
        list.push({
          id: 'missing-queue',
          title: 'Decouple services with a queue',
          category: 'Decoupling',
          severity: 'medium',
          reason: 'Services call each other synchronously, so one slow service slows the others. A queue absorbs bursts and survives restarts.',
          actionLabel: 'Insert SQS queue',
          apply: () => void insertOrWire(serviceNodes[0]!.id, serviceNodes[1]!.id, { label: 'Task Queue', type: 'queue', awsIcon: 'sqs', subType: 'Amazon SQS' }),
        });
      }
      if (!hasStorage && nodes.length >= 3) {
        list.push({
          id: 'missing-storage',
          title: 'Keep files in object storage',
          category: 'Reliability',
          severity: 'low',
          reason: 'Uploads and large payloads belong in object storage such as S3, which keeps compute stateless.',
          actionLabel: 'Add S3 bucket',
          apply: () => void addAndConnect((serviceNodes[0] ?? nodes[0]!).id, { label: 'S3 Storage', type: 'storage', awsIcon: 's3', subType: 'Amazon S3 Bucket' }, 'puts assets'),
        });
      }
      if (hasClient && !hasAuth) {
        list.push({
          id: 'missing-auth',
          title: 'Authenticate requests',
          category: 'Security',
          severity: 'high',
          reason: 'Nothing in this diagram checks who is calling. Add an identity service and validate tokens at the entrance.',
          actionLabel: 'Add Cognito auth',
          apply: () => {
            const gateway = nodes.find((n) => n.data.type === 'gateway') ?? nodes[0]!;
            void addAndConnect(gateway.id, { label: 'Cognito Auth', type: 'service', awsIcon: 'cognito', subType: 'AWS Cognito' }, 'validates JWT');
          },
        });
      }
    }

    const readiness = nodes.length === 0 ? 0 : Math.max(10, 100 - list.reduce((sum, s) => sum + COST[s.severity], 0));
    return { suggestions: list, readiness, empty: nodes.length === 0, count: nodes.length };
  }, [nodes]);
}
