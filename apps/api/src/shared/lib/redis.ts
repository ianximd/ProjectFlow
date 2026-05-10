/**
 * Shared Redis singleton — single ioredis connection used by all consumers
 * (cache helpers and rate-limiter middleware) so the process holds exactly
 * one Redis connection regardless of how many modules import it.
 */

import { Redis } from 'ioredis';

let _redis: Redis | null = null;
let _down = false;

/** Returns true when the last Redis operation failed (connection is down). */
export function isRedisDown(): boolean {
  return _down;
}

/**
 * Returns the shared Redis client, creating it on first call.
 * Safe to call from multiple modules — always returns the same instance.
 */
export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    _redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck:     true,
      lazyConnect:          false,
    });

    _redis.on('error', (err) => {
      if (!_down) console.warn('[redis] Connection error — degrading gracefully:', err?.message);
      _down = true;
    });

    _redis.on('ready', () => {
      if (_down) console.info('[redis] Connection restored');
      _down = false;
    });
  }
  return _redis;
}
