/**
 * Wipe Redis rate-limit keys before each E2E run so the auth limiter
 * (10 req / 15 min in dev mode) doesn't 429 the test's own register +
 * login calls — especially on a developer's machine after multiple
 * iterations.
 *
 * Cache namespace `rl:*` is the rate-limiter's prefix per
 * apps/api/src/shared/middleware/rateLimiter.middleware.ts. Other Redis
 * keys (BullMQ jobs, response cache, idempotency) are left alone.
 */

import Redis from 'ioredis';

export default async function globalSetup() {
  const url   = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  try {
    let cursor = '0';
    let cleared = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        cleared += keys.length;
      }
    } while (cursor !== '0');
    if (cleared > 0) {
      // eslint-disable-next-line no-console
      console.log(`[e2e] cleared ${cleared} rate-limit keys`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e] could not flush rate-limit keys:', (err as Error).message);
  } finally {
    redis.disconnect();
  }
}
