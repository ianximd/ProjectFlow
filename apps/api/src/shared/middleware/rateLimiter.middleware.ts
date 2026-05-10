/**
 * Distributed rate-limiter backed by Redis (ioredis).
 *
 * Uses the INCR + EXPIRE pattern:
 *   INCR  <key>           → atomically increment; Redis returns the new count
 *   EXPIRE <key> <ttlSec> → set TTL only when the key is brand-new (count === 1)
 *
 * Falls back to an in-memory Map when Redis is unavailable so the server
 * degrades gracefully rather than rejecting all requests.
 */

import type { Context, Next } from 'hono';
import { getRedis, isRedisDown } from '../lib/redis.js';

// ── In-memory fallback ────────────────────────────────────────────────────────

interface RateLimitWindow { count: number; resetAt: number; }
const memStore = new Map<string, RateLimitWindow>();

setInterval(() => {
  const now = Date.now();
  for (const [k, w] of memStore) {
    if (now >= w.resetAt) memStore.delete(k);
  }
}, 5 * 60_000).unref();

// ── Core implementation ───────────────────────────────────────────────────────

interface RateLimiterOptions {
  /** Maximum requests allowed within the window. Default: 1000 */
  max: number;
  /** Window duration in milliseconds. Default: 60_000 (1 minute) */
  windowMs: number;
}

type RateLimitOptions = Partial<RateLimiterOptions>;

async function getCount(key: string, windowMs: number): Promise<{ count: number; resetIn: number }> {
  const windowSec = Math.ceil(windowMs / 1000);

  if (!isRedisDown()) {
    try {
      const redis = getRedis();
      const count = await redis.incr(key);
      if (count === 1) {
        // New key — set TTL so Redis auto-expires the window
        await redis.expire(key, windowSec);
      }
      const ttl = await redis.ttl(key);
      return { count, resetIn: Math.max(0, ttl) };
    } catch {
      // fall through to in-memory on transient error
    }
  }

  // In-memory fallback
  const now = Date.now();
  const existing = memStore.get(key);
  if (!existing || now >= existing.resetAt) {
    memStore.set(key, { count: 1, resetAt: now + windowMs });
    return { count: 1, resetIn: windowSec };
  }
  existing.count += 1;
  return { count: existing.count, resetIn: Math.ceil((existing.resetAt - now) / 1000) };
}

/**
 * Returns a Hono middleware that enforces a sliding-window rate limit.
 *
 * Keyed by userId (from auth token) falling back to client IP.
 * Responds 429 when the limit is exceeded.
 */
export function rateLimiter(options: RateLimitOptions = {}) {
  const max      = options.max      ?? 1000;
  const windowMs = options.windowMs ?? 60_000;

  return async (c: Context, next: Next): Promise<Response | void> => {
    const user    = c.get('user') as any | undefined;
    const clientIp = c.req.header('CF-Connecting-IP')
      ?? c.req.header('X-Forwarded-For')?.split(',')[0].trim()
      ?? 'anon';
    const keyBase = user?.userId ?? clientIp;
    const key     = `rl:${keyBase}:${Math.ceil(windowMs / 1000)}`;

    const { count, resetIn } = await getCount(key, windowMs);
    const remaining = Math.max(0, max - count);

    c.header('X-RateLimit-Limit',     String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset',     String(resetIn));

    if (count > max) {
      return c.json(
        { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please retry later.', statusCode: 429 } },
        429,
      );
    }

    await next();
  };
}

/** Stricter variant for auth endpoints: 10 requests / 15 minutes */
export function authRateLimiter() {
  return rateLimiter({ max: 10, windowMs: 15 * 60_000 });
}

