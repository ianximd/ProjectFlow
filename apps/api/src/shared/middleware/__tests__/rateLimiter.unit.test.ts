import { beforeEach, describe, expect, it } from 'vitest';
import { _testing } from '../rateLimiter.middleware.js';

const { memStore, MEM_STORE_MAX, evictIfOverCap } = _testing;

beforeEach(() => {
  memStore.clear();
});

describe('rate-limiter memStore cap', () => {
  it('does nothing when under the cap', () => {
    for (let i = 0; i < 10; i++) {
      memStore.set(`k${i}`, { count: 1, resetAt: Date.now() + 60_000 });
    }
    evictIfOverCap();
    expect(memStore.size).toBe(10);
  });

  it('evicts ~10% of oldest entries when over the cap', () => {
    const now = Date.now();
    for (let i = 0; i <= MEM_STORE_MAX; i++) {
      // Oldest resetAt for low i → those should be evicted first
      memStore.set(`k${i}`, { count: 1, resetAt: now + i });
    }
    evictIfOverCap();
    const expected = MEM_STORE_MAX + 1 - Math.floor(MEM_STORE_MAX * 0.1);
    expect(memStore.size).toBe(expected);
    // The very-oldest key should be gone.
    expect(memStore.has('k0')).toBe(false);
    // The newest key should remain.
    expect(memStore.has(`k${MEM_STORE_MAX}`)).toBe(true);
  });
});
