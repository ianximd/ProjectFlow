/**
 * HTTP request log — one line per incoming request, after the handler has
 * resolved. Slot it AFTER requestIdMiddleware so each line carries the
 * X-Request-ID, and AFTER authMiddleware where possible so we get the
 * user id too. The middleware itself is mounted globally; user id only
 * shows up for routes that go through authMiddleware.
 *
 * Health checks and /api/v1/health are noisy on a Kubernetes liveness
 * probe so we drop those to DEBUG. Everything else logs at INFO.
 */

import type { Context, Next } from 'hono';
import { logger } from '../lib/logger.js';

const HEALTH_PATHS = new Set(['/api/v1/health', '/health']);

export async function httpLogMiddleware(c: Context, next: Next) {
  const start     = Date.now();
  const method    = c.req.method;
  const path      = c.req.path;
  const requestId = (c.get('requestId') as string | undefined) ?? '-';

  // Don't pre-log; the response line tells the full story in one entry.
  let err: unknown = null;
  try {
    await next();
  } catch (e) {
    err = e;
    throw e;
  } finally {
    const duration = Date.now() - start;
    const status   = c.res?.status ?? (err ? 500 : 0);
    const user     = (c.get('user') as any) ?? null;
    const userId   = user?.userId ?? user?.id ?? null;

    const fields = {
      req:       requestId,
      method,
      path,
      status,
      durationMs: duration,
      userId,
    };

    const level =
      err              ? 'error' :
      status >= 500    ? 'error' :
      status >= 400    ? 'warn'  :
      HEALTH_PATHS.has(path) ? 'debug' :
      'info';

    if (err) {
      logger[level]({ ...fields, err: (err as Error).message }, `${method} ${path} → ${status}`);
    } else {
      logger[level](fields, `${method} ${path} → ${status}`);
    }
  }
}
