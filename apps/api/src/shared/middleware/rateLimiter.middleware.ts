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
import { getConnInfo } from '@hono/node-server/conninfo';
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
 * What counts: every request that passes through here. We increment
 * BEFORE next() — a 401, 422, or 500 from the downstream handler all
 * consume one slot the same as a 200. This is intentional (anti-abuse:
 * don't let attackers iterate cheaply on bad-credential responses) but
 * means a typo on the login form costs a slot.
 *
 * Keying: prefers userId when it's already on the context, otherwise
 * falls back to client IP. NB: this runs before authMiddleware, so for
 * unauthenticated routes (and /auth/* in particular) userId is never
 * set — those endpoints are always IP-keyed.
 *
 * IP resolution prefers proxy headers (CF-Connecting-IP, X-Forwarded-For)
 * for prod-behind-CDN deployments and falls back to the raw socket
 * address. Without the socket fallback, dev (no proxy) collapsed
 * everyone into a single global "anon" bucket — that's where the
 * "10 requests then 429" frustration came from on localhost.
 *
 * Responds 429 when the limit is exceeded; sets X-RateLimit-* headers
 * on every response so the client can pace itself.
 */
export function rateLimiter(options: RateLimitOptions = {}) {
  const max      = options.max      ?? 1000;
  const windowMs = options.windowMs ?? 60_000;

  return async (c: Context, next: Next): Promise<Response | void> => {
    const user    = c.get('user') as any | undefined;
    const clientIp = resolveClientIp(c);
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

/**
 * Best-effort client IP. Trusts proxy headers first (so a CDN-fronted
 * deploy keys by the real client), falls back to the raw socket
 * address (so dev gets per-machine isolation instead of one global
 * "anon" bucket), and finally to the literal 'anon' if even the
 * socket lookup throws.
 */
function resolveClientIp(c: Context): string {
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const xff = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
  if (xff) return xff;
  try {
    return getConnInfo(c).remote.address ?? 'anon';
  } catch {
    return 'anon';
  }
}

/**
 * Stricter variant for auth endpoints.
 *
 * Production: 10 requests / 15 minutes — tight enough to slow
 * credential stuffing while not blocking a real human who fat-fingers
 * their password a few times.
 *
 * Development: 200 requests / 15 minutes — a single open tab burns
 * ~3 slots per window via the SPA's silent-refresh, so the prod cap
 * leaves <10 slots for actual interactive work and E2E specs blow
 * through it in seconds. The dev cap stays low enough that a runaway
 * test loop still trips, but high enough to not constantly bite.
 *
 * Tests skip the middleware entirely (see server.ts NODE_ENV check),
 * so this distinction never applies inside vitest.
 */
export function authRateLimiter() {
  const max = process.env.NODE_ENV === 'production' ? 10 : 200;
  return rateLimiter({ max, windowMs: 15 * 60_000 });
}

