/**
 * HTTP response cache middleware for Hono.
 *
 * Caches GET responses in Redis with a configurable TTL.
 * The cache key is derived from the authenticated user ID + full request URL
 * so that responses from different users are never shared.
 *
 * Cache is automatically bypassed for:
 *  - Non-GET requests
 *  - Responses with status >= 400
 *  - Requests that set `Cache-Control: no-cache`
 *
 * A hit adds `X-Cache: HIT` and a miss adds `X-Cache: MISS`.
 */

import type { Context, Next } from 'hono';
import { cacheGet, cacheSet } from '../lib/cache.js';

/** Don't waste Redis on multi-MB responses (reports, big search dumps). */
const MAX_CACHE_BODY_BYTES = 256 * 1024;

interface ResponseCacheOptions {
  /** Cache TTL in seconds. Default: 30. */
  ttl?: number;
  /**
   * Optional function to derive the cache key from the context.
   * Defaults to `<userId>:<req.url>` — scopes every cached response to the
   * authenticated user so different users never share a cache entry.
   * Falls back to `anon:<req.url>` for unauthenticated routes.
   */
  keyFn?: (c: Context) => string;
  /**
   * Optional function: return false to skip caching for this request.
   */
  shouldCache?: (c: Context) => boolean;
}

interface CachedResponse {
  body:    string;
  status:  number;
  headers: Record<string, string>;
}

/**
 * Derive a user-scoped cache key using pathname + search (no host).
 * Excluding the host makes keys host-agnostic so pattern-based invalidation
 * works with cacheDelPattern regardless of the deployment URL.
 *
 * authMiddleware sets c.get('user') before responseCache runs, so the JWT
 * payload is always available on protected routes.
 */
function defaultKeyFn(c: Context): string {
  const user = c.get('user') as { userId?: string } | undefined;
  const uid  = user?.userId ?? 'anon';
  // Extract pathname+search from the full URL (drop the host)
  const { pathname, search } = new URL(c.req.url);
  return `${uid}:${pathname}${search}`;
}

export function responseCache(options: ResponseCacheOptions = {}) {
  const {
    ttl         = 30,
    keyFn       = defaultKeyFn,
    shouldCache = () => true,
  } = options;

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Only cache GET requests
    if (c.req.method !== 'GET') return next();
    // Honour no-cache directive
    if (c.req.header('Cache-Control') === 'no-cache') return next();
    // Custom bypass
    if (!shouldCache(c)) return next();

    const key = `http:${keyFn(c)}`;

    // ── Cache hit ─────────────────────────────────────────────────────────
    const cached = await cacheGet<CachedResponse>(key);
    if (cached) {
      return new Response(cached.body, {
        status:  cached.status,
        headers: { ...cached.headers, 'X-Cache': 'HIT' },
      });
    }

    // ── Cache miss: run handler ────────────────────────────────────────────
    await next();

    // Only cache successful responses
    if (c.res && c.res.status < 400) {
      const body = await c.res.clone().text();
      const newHeaders = new Headers(c.res.headers);

      if (Buffer.byteLength(body, 'utf8') <= MAX_CACHE_BODY_BYTES) {
        const headers: Record<string, string> = {};
        c.res.headers.forEach((v, k) => { headers[k] = v; });
        const toStore: CachedResponse = { body, status: c.res.status, headers };
        cacheSet(key, toStore, ttl).catch(() => {});
        newHeaders.set('X-Cache', 'MISS');
      } else {
        newHeaders.set('X-Cache', 'BYPASS-SIZE');
      }
      c.res = new Response(body, { status: c.res.status, headers: newHeaders });
    }
  };
}

export const _testing = { MAX_CACHE_BODY_BYTES };
