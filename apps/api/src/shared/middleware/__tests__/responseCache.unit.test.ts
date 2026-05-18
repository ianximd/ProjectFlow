import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setCalls: [] as Array<{ key: string; value: unknown; ttl: number }>,
}));

vi.mock('../../lib/cache.js', () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async (key: string, value: unknown, ttl: number) => {
    mocks.setCalls.push({ key, value, ttl });
  }),
}));

const { responseCache } = await import('../responseCache.middleware.js');

function makeContext(body: string) {
  const ctx: any = {
    req: { method: 'GET', url: 'http://x/test', header: () => undefined },
    res: new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    get: () => ({ userId: 'u1' }),
  };
  return ctx;
}

afterEach(() => { mocks.setCalls.length = 0; });

describe('responseCache body-size guard', () => {
  it('caches small responses', async () => {
    const mw = responseCache({ ttl: 30 });
    const ctx = makeContext('small body');
    await mw(ctx, async () => {});
    expect(mocks.setCalls).toHaveLength(1);
    expect(ctx.res.headers.get('X-Cache')).toBe('MISS');
  });

  it('skips caching when body exceeds 256 KB', async () => {
    const mw = responseCache({ ttl: 30 });
    const huge = 'x'.repeat(257 * 1024);
    const ctx = makeContext(huge);
    await mw(ctx, async () => {});
    expect(mocks.setCalls).toHaveLength(0);
    expect(ctx.res.headers.get('X-Cache')).toBe('BYPASS-SIZE');
  });
});
