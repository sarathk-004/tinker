import { setTimeout as delay } from 'node:timers/promises';

/**
 * Last-resort handlers for both processes (API and worker). An unexpected error is logged (name only, never the message, which could
 * carry a connection string) and the process exits non-zero after a graceful stop, so the host restarts it into a clean state.
 * Shutdown never waits forever: a stuck request or an open voice socket cannot block a deploy.
 */
export function installProcessGuards(stop: () => Promise<void>, log: (line: Record<string, unknown>) => void = (line) => console.error(JSON.stringify(line)), graceMs = 10_000): (signal: string, code?: number) => Promise<void> {
  let stopping = false;
  const shutdown = async (signal: string, code = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log({ level: 'info', msg: 'shutting down', signal });
    const forced = delay(graceMs).then(() => {
      log({ level: 'error', msg: 'shutdown took too long, exiting', graceMs });
      process.exit(code || 1);
    });
    await Promise.race([stop().catch(() => undefined), forced]);
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log({ level: 'error', msg: 'unhandled rejection', name: reason instanceof Error ? reason.name : typeof reason });
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    log({ level: 'error', msg: 'uncaught exception', name: error.name });
    void shutdown('uncaughtException', 1);
  });
  return shutdown;
}
