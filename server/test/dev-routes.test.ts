import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '@tinker/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/infrastructure/config/config.ts';

const dev = loadConfig({ NODE_ENV: 'development', LOG_LEVEL: 'silent' });

interface Sample { graph: { nodes: { id: string; name: string }[]; edges: unknown[] }; presentation: unknown }

describe('dev engine preview (development only)', () => {
  it('runs the Orders -> Redis -> PostgreSQL scenario end to end over HTTP', async () => {
    const app = await buildApp({ config: dev, logger: false });
    const sample = (await app.inject({ method: 'GET', url: '/dev/engine/sample' })).json<Sample>();
    const id = (name: string) => sample.graph.nodes.find((n) => n.name === name)?.id;

    const res = await app.inject({
      method: 'POST', url: '/dev/engine/apply',
      payload: { ...sample, command: { type: 'INSERT_BETWEEN', sourceNodeId: id('Orders'), targetNodeId: id('PostgreSQL'), node: { name: 'Redis', kind: 'CACHE' } } },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json<Sample & { appliedCommand: { type: string } }>();
    expect(out.appliedCommand.type).toBe('INSERT_BETWEEN');
    expect(out.graph.nodes.map((n) => n.name)).toEqual(['Orders', 'PostgreSQL', 'Redis']);
    expect(out.graph.edges).toHaveLength(2);

    const down = await app.inject({ method: 'POST', url: '/dev/engine/downstream', payload: { graph: out.graph, nodeId: id('Orders') } });
    expect(down.json<{ downstream: string[] }>().downstream).toHaveLength(2);
    await app.close();
  });

  it('maps a domain refusal to a 422 envelope with a machine-readable reason', async () => {
    const app = await buildApp({ config: dev, logger: false });
    const sample = (await app.inject({ method: 'GET', url: '/dev/engine/sample' })).json<Sample>();
    const res = await app.inject({
      method: 'POST', url: '/dev/engine/apply',
      payload: { ...sample, command: { type: 'REMOVE_NODE', nodeId: '00000000-0000-4000-8000-00000000dead' } },
    });
    expect(res.statusCode).toBe(422);
    const body = errorEnvelopeSchema.parse(res.json());
    expect(body.error.code).toBe('DOMAIN_VALIDATION_FAILED');
    expect(body.error.details).toMatchObject({ reason: 'NODE_NOT_FOUND' });
    await app.close();
  });

  it('is not registered in test or production', async () => {
    for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com', DATABASE_URL: 'postgres://u:p@h/db', SUPABASE_URL: 'https://x.supabase.co', AI_KEY_MODE: 'server' }]) {
      const app = await buildApp({ config: loadConfig({ ...env, LOG_LEVEL: 'silent' }), logger: false });
      const res = await app.inject({ method: 'GET', url: '/dev/engine/sample' });
      expect(res.statusCode).toBe(404);
      await app.close();
    }
  });
});
