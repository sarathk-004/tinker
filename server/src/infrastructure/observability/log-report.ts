/**
 * Turns the API and worker's structured log lines (one JSON object per line) into the numbers a release needs:
 * latency percentiles per route, conflicts, failures by error code, AI provider outcomes and latency, job outcomes and lease takeovers.
 * Pure: takes lines, returns a summary. The logs contain no bodies, tokens, prompts or user text, so neither does this.
 */
export interface RouteStats {
  route: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  statuses: Record<string, number>;
}

export interface LogSummary {
  lines: number;
  requests: number;
  routes: RouteStats[];
  /** Error code -> count, for failed API answers (409 conflicts, 429, AI_TIMEOUT...). */
  errorCodes: Record<string, number>;
  conflicts: number;
  ai: { attempts: Record<string, number>; latencyOkMs: { count: number; p50: number; p95: number; max: number }; failures: Record<string, number> };
  jobs: { claimed: number; takeovers: number; completed: number; retried: number; deadLettered: number; fenced: number; byType: Record<string, { count: number; p95Ms: number }> };
  voice: { sessions: number; reasons: Record<string, number> };
}

/** Nearest-rank percentile of an unsorted list (0 for an empty list). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

const bump = (map: Record<string, number>, key: string) => void (map[key] = (map[key] ?? 0) + 1);

export function summarize(lines: Iterable<string>): LogSummary {
  const perRoute = new Map<string, { ms: number[]; statuses: Record<string, number> }>();
  const errorCodes: Record<string, number> = {};
  const aiAttempts: Record<string, number> = {};
  const aiFailures: Record<string, number> = {};
  const aiOk: number[] = [];
  const jobMs = new Map<string, number[]>();
  const voiceReasons: Record<string, number> = {};
  const out: LogSummary = {
    lines: 0,
    requests: 0,
    routes: [],
    errorCodes,
    conflicts: 0,
    ai: { attempts: aiAttempts, latencyOkMs: { count: 0, p50: 0, p95: 0, max: 0 }, failures: aiFailures },
    jobs: { claimed: 0, takeovers: 0, completed: 0, retried: 0, deadLettered: 0, fenced: 0, byType: {} },
    voice: { sessions: 0, reasons: voiceReasons },
  };

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // not a log line
    }
    if (!entry || typeof entry !== 'object') continue;
    out.lines += 1;
    const msg = entry['msg'];
    if (msg === 'request' && typeof entry['route'] === 'string' && typeof entry['ms'] === 'number') {
      out.requests += 1;
      const key = `${entry['method'] ?? '?'} ${entry['route']}`;
      const slot = perRoute.get(key) ?? { ms: [], statuses: {} };
      slot.ms.push(entry['ms']);
      bump(slot.statuses, String(entry['status']));
      perRoute.set(key, slot);
      if (typeof entry['code'] === 'string') {
        bump(errorCodes, entry['code']);
        if (entry['code'] === 'DIAGRAM_VERSION_CONFLICT') out.conflicts += 1;
      }
    } else if (msg === 'ai provider attempt') {
      const outcome = String(entry['outcome'] ?? '?');
      bump(aiAttempts, outcome);
      if (outcome === 'ok' && typeof entry['ms'] === 'number') aiOk.push(entry['ms']);
    } else if (msg === 'ai provider failure' || msg === 'speech failure' || msg === 'voice provider failure') {
      bump(aiFailures, `${msg}: ${String(entry['kind'] ?? '?')}`);
    } else if (msg === 'job claimed') {
      out.jobs.claimed += 1;
      if (entry['tookOver'] === true) out.jobs.takeovers += 1;
    } else if (typeof msg === 'string' && msg.startsWith('job ') && typeof entry['type'] === 'string') {
      if (msg === 'job completed') out.jobs.completed += 1;
      else if (msg === 'job will retry') out.jobs.retried += 1;
      else if (msg === 'job dead-lettered') out.jobs.deadLettered += 1;
      else if (msg === 'job fenced') out.jobs.fenced += 1;
      if (typeof entry['ms'] === 'number') jobMs.set(entry['type'], [...(jobMs.get(entry['type']) ?? []), entry['ms']]);
    } else if (msg === 'voice session ended') {
      out.voice.sessions += 1;
      bump(voiceReasons, String(entry['reason'] ?? '?'));
    }
  }

  out.routes = [...perRoute.entries()]
    .map(([route, { ms, statuses }]) => ({ route, count: ms.length, p50: percentile(ms, 50), p95: percentile(ms, 95), p99: percentile(ms, 99), max: Math.max(...ms), statuses }))
    .sort((a, b) => b.count - a.count);
  out.ai.latencyOkMs = { count: aiOk.length, p50: percentile(aiOk, 50), p95: percentile(aiOk, 95), max: aiOk.length ? Math.max(...aiOk) : 0 };
  for (const [type, values] of jobMs) out.jobs.byType[type] = { count: values.length, p95Ms: percentile(values, 95) };
  return out;
}

export function formatSummary(s: LogSummary): string {
  const rows = s.routes.map((r) => `  ${r.route.padEnd(46)} n=${String(r.count).padStart(5)}  p50=${r.p50}  p95=${r.p95}  p99=${r.p99}  max=${r.max} ms  ${Object.entries(r.statuses).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  return [
    `${s.lines} log lines, ${s.requests} API requests`,
    ...rows,
    `conflicts (409 version): ${s.conflicts}`,
    `error codes: ${Object.entries(s.errorCodes).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
    `AI attempts: ${Object.entries(s.ai.attempts).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}; ok latency p50=${s.ai.latencyOkMs.p50} p95=${s.ai.latencyOkMs.p95} max=${s.ai.latencyOkMs.max} ms (n=${s.ai.latencyOkMs.count})`,
    `AI/voice/speech failures: ${Object.entries(s.ai.failures).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
    `jobs: claimed=${s.jobs.claimed} takeovers=${s.jobs.takeovers} completed=${s.jobs.completed} retried=${s.jobs.retried} dead-lettered=${s.jobs.deadLettered} fenced=${s.jobs.fenced}`,
    `voice sessions ended: ${s.voice.sessions} ${Object.entries(s.voice.reasons).map(([k, v]) => `${k}=${v}`).join(' ')}`,
  ].join('\n');
}
