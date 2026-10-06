/** Tiny HTTP helper shared by the live check scripts (smoke, benchmark): JSON in, JSON out, optional timing. */
export interface Reply {
  status: number;
  json: any;
  headers: Headers;
  ms: number;
}

export function client(base: string, token?: string) {
  return async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> => {
    const started = performance.now();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(method !== 'GET' && method !== 'DELETE' && !extra['idempotency-key'] && !path.startsWith('/dev/') && !path.endsWith('/ask') && !path.endsWith('/speak') ? { 'idempotency-key': crypto.randomUUID() } : {}),
        ...(method === 'DELETE' ? { 'idempotency-key': crypto.randomUUID() } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => undefined);
    return { status: res.status, json, headers: res.headers, ms: performance.now() - started };
  };
}

export async function devLogin(base: string, email: string): Promise<string> {
  const res = await client(base)('POST', '/dev/auth/login', { email });
  if (res.status !== 200) throw new Error(`dev login failed (HTTP ${res.status}). Is the API running with AUTH_MODE=dev?`);
  return res.json.token as string;
}
