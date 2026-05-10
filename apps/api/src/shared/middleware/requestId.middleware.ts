import type { Context, Next } from 'hono';
import crypto from 'node:crypto';

/**
 * Adds an X-Request-ID response header to every request.
 * Re-uses the incoming header value if present, otherwise generates a UUID v4.
 */
export async function requestIdMiddleware(c: Context, next: Next) {
  const incoming = c.req.header('X-Request-ID');
  const requestId = incoming && incoming.length <= 64
    ? incoming
    : crypto.randomUUID();

  c.set('requestId', requestId);
  await next();
  c.res.headers.set('X-Request-ID', requestId);
}
