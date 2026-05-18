// apps/api/src/shared/lib/shutdown.ts
import { subLogger } from './logger.js';

const log = subLogger('shutdown');

type Closer = { name: string; close: () => Promise<unknown> };

const closers: Closer[] = [];
let running = false;

/**
 * Register a cleanup function. Closers run in REVERSE registration order
 * (last-registered first) so callers can mirror "open dependencies first"
 * (e.g. ioredis registered before BullMQ workers means workers close first).
 */
export function registerCloser(name: string, close: () => Promise<unknown>): void {
  closers.push({ name, close });
}

/** Test-only — clear the registry between tests. */
export function _resetClosersForTest(): void {
  closers.length = 0;
  running = false;
  inflight = null;
}

let inflight: Promise<void> | null = null;

/**
 * Run every registered closer with a hard 10s timeout per closer.
 * Errors are logged and swallowed so one stuck closer never blocks the rest.
 * Idempotent — re-entrant calls return the in-flight promise.
 */
export function runShutdown(reason: string): Promise<void> {
  if (inflight) return inflight;
  running = true;
  log.info({ reason, count: closers.length }, 'shutdown begin');

  inflight = (async () => {
    for (const c of [...closers].reverse()) {
      try {
        await Promise.race([
          c.close(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000)),
        ]);
        log.info({ name: c.name }, 'closer ok');
      } catch (err) {
        log.warn({ name: c.name, err: (err as Error).message }, 'closer failed');
      }
    }
    log.info('shutdown complete');
  })();

  return inflight;
}

export function isShuttingDown(): boolean {
  return running;
}
