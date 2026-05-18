# Memory-Leak & Lifecycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the five memory / lifecycle issues found in the May 2026 review of `apps/api` (graceful shutdown, in-memory GraphQL pubsub, unbounded rate-limit map, uncapped response-cache body, uncapped outgoing-webhook response body) so the API survives restarts and adversarial conditions without unbounded growth.

**Architecture:**
Each fix is local to one or two files in `apps/api`. We add a shared `shutdown` orchestrator that the workers, queues, ioredis singleton, and the mssql pool register into; the other four fixes are surgical guards inside existing middleware/utility modules. All changes ship behind unit tests under `vitest --project unit`. Phase 5 (Redis pubsub) is sequenced last because it introduces a new npm dependency.

**Tech Stack:** Node 20, TypeScript 5, Hono 4, BullMQ 5, ioredis 5, mssql 12, graphql-yoga 5, vitest 4.

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `apps/api/src/shared/lib/shutdown.ts` | Create | Central registry of `() => Promise<void>` closers, executed in reverse-registration order on SIGTERM/SIGINT. |
| `apps/api/src/shared/lib/__tests__/shutdown.unit.test.ts` | Create | Unit tests for ordering, idempotency, and error isolation. |
| `apps/api/src/shared/lib/redis.ts` | Modify | Register `_redis.quit()` with shutdown on creation. |
| `apps/api/src/shared/lib/db.ts` | Modify | Register `closePool()` with shutdown on creation. |
| `apps/api/src/modules/automation/automation.queue.ts` | Modify | Register `automationQueue.close()` with shutdown at module init. |
| `apps/api/src/modules/automation/automation.worker.ts` | Modify | Register returned `worker.close()` with shutdown. |
| `apps/api/src/modules/webhooks/webhook-outgoing.queue.ts` | Modify | Register `outgoingWebhookQueue.close()` with shutdown. |
| `apps/api/src/modules/webhooks/webhook-outgoing.worker.ts` | Modify | Register returned `worker.close()` with shutdown. |
| `apps/api/src/modules/auth/oauth/workers/oauth-maintenance.worker.ts` | Modify | Register returned `queue.close()` + `worker.close()` with shutdown. |
| `apps/api/src/server.ts` | Modify | Install SIGTERM / SIGINT handlers that invoke shutdown. |
| `apps/api/src/shared/middleware/rateLimiter.middleware.ts` | Modify | Cap `memStore` size; evict oldest when over cap. |
| `apps/api/src/shared/middleware/__tests__/rateLimiter.unit.test.ts` | Create | Unit test for cap + eviction. |
| `apps/api/src/shared/middleware/responseCache.middleware.ts` | Modify | Skip caching responses whose body exceeds `MAX_CACHE_BODY_BYTES`. |
| `apps/api/src/shared/middleware/__tests__/responseCache.unit.test.ts` | Create | Unit test for size guard. |
| `apps/api/src/modules/webhooks/webhook-outgoing.dispatcher.ts` | Modify | Read response stream with a 64 KB ceiling instead of `res.text()`. |
| `apps/api/src/modules/webhooks/__tests__/webhook-outgoing.dispatcher.unit.test.ts` | Create | Unit test for body cap. |
| `apps/api/src/graphql/pubsub.ts` | Modify | Use `@graphql-yoga/redis-event-target` when `REDIS_URL` is set; fallback to in-memory only when unset (dev / tests). |
| `apps/api/package.json` | Modify | Add `@graphql-yoga/redis-event-target` dependency. |

---

## Phase 1 — Central shutdown orchestrator

### Task 1: Create the shutdown registry

**Files:**
- Create: `apps/api/src/shared/lib/shutdown.ts`

- [ ] **Step 1: Create the module**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/shared/lib/shutdown.ts
git commit -m "feat(api): add central shutdown orchestrator"
```

---

### Task 2: Test the shutdown registry

**Files:**
- Create: `apps/api/src/shared/lib/__tests__/shutdown.unit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/shared/lib/__tests__/shutdown.unit.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerCloser,
  runShutdown,
  _resetClosersForTest,
  isShuttingDown,
} from '../shutdown.js';

beforeEach(() => {
  _resetClosersForTest();
});

describe('shutdown registry', () => {
  it('runs closers in reverse-registration order', async () => {
    const order: string[] = [];
    registerCloser('first',  async () => { order.push('first'); });
    registerCloser('second', async () => { order.push('second'); });
    registerCloser('third',  async () => { order.push('third'); });

    await runShutdown('test');
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('isolates failures — one throw does not stop others', async () => {
    const order: string[] = [];
    registerCloser('a', async () => { order.push('a'); });
    registerCloser('b', async () => { throw new Error('boom'); });
    registerCloser('c', async () => { order.push('c'); });

    await runShutdown('test');
    expect(order).toEqual(['c', 'a']);
  });

  it('is idempotent — second call returns the same in-flight promise', async () => {
    let calls = 0;
    registerCloser('once', async () => { calls += 1; });

    const a = runShutdown('first');
    const b = runShutdown('second');
    expect(a).toBe(b);
    await a;
    expect(calls).toBe(1);
  });

  it('flips isShuttingDown to true', async () => {
    expect(isShuttingDown()).toBe(false);
    const done = runShutdown('test');
    expect(isShuttingDown()).toBe(true);
    await done;
  });

  it('times out a stuck closer after 10s without blocking peers', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    registerCloser('fast', async () => { order.push('fast'); });
    registerCloser('stuck', () => new Promise(() => { /* never resolves */ }));

    const done = runShutdown('test');
    await vi.advanceTimersByTimeAsync(11_000);
    await done;
    expect(order).toEqual(['fast']);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the tests — confirm they pass**

Run: `cd apps/api && npx vitest run --project unit src/shared/lib/__tests__/shutdown.unit.test.ts`
Expected: 5 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shared/lib/__tests__/shutdown.unit.test.ts
git commit -m "test(api): cover shutdown registry ordering and isolation"
```

---

### Task 3: Register ioredis with shutdown

**Files:**
- Modify: `apps/api/src/shared/lib/redis.ts`

- [ ] **Step 1: Update `getRedis` to register a closer**

Replace the body of `getRedis()` so the registration happens exactly once, on creation:

```ts
// apps/api/src/shared/lib/redis.ts
import { Redis } from 'ioredis';
import { subLogger } from './logger.js';
import { registerCloser } from './shutdown.js';

const log = subLogger('redis');

let _redis: Redis | null = null;
let _down = false;

export function isRedisDown(): boolean {
  return _down;
}

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    _redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck:     true,
      lazyConnect:          false,
    });

    _redis.on('error', (err) => {
      if (!_down) log.warn({ err: err?.message }, 'connection error — degrading gracefully');
      _down = true;
    });

    _redis.on('ready', () => {
      if (_down) log.info('connection restored');
      _down = false;
    });

    registerCloser('redis', async () => {
      if (_redis) {
        await _redis.quit().catch(() => _redis?.disconnect());
        _redis = null;
      }
    });
  }
  return _redis;
}
```

- [ ] **Step 2: Run unit tests for shutdown — confirm still green**

Run: `cd apps/api && npx vitest run --project unit src/shared/lib/__tests__/shutdown.unit.test.ts`
Expected: 5 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shared/lib/redis.ts
git commit -m "feat(api): register redis client with shutdown orchestrator"
```

---

### Task 4: Register mssql pool with shutdown

**Files:**
- Modify: `apps/api/src/shared/lib/db.ts`

- [ ] **Step 1: Register `closePool` on first connect**

Edit `getPool()` so the closer is registered exactly once:

```ts
// apps/api/src/shared/lib/db.ts — add to imports
import { registerCloser } from './shutdown.js';

// replace getPool() body:
export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = await new sql.ConnectionPool(config).connect();
    pool.on('error', (err) => {
      log.error({ err: err?.message }, 'pool error');
    });
    registerCloser('mssql-pool', () => closePool());
  }
  return pool;
}
```

`closePool` already exists below and sets `pool = null` after closing — leave it unchanged.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/shared/lib/db.ts
git commit -m "feat(api): register mssql pool with shutdown orchestrator"
```

---

### Task 5: Register BullMQ queues + workers with shutdown

**Files:**
- Modify: `apps/api/src/modules/automation/automation.queue.ts`
- Modify: `apps/api/src/modules/automation/automation.worker.ts`
- Modify: `apps/api/src/modules/webhooks/webhook-outgoing.queue.ts`
- Modify: `apps/api/src/modules/webhooks/webhook-outgoing.worker.ts`
- Modify: `apps/api/src/modules/auth/oauth/workers/oauth-maintenance.worker.ts`

- [ ] **Step 1: Automation queue**

Append after the `export const automationQueue = ...` block:

```ts
// apps/api/src/modules/automation/automation.queue.ts
import { registerCloser } from '../../shared/lib/shutdown.js';
// ... existing exports ...
registerCloser('automation-queue', () => automationQueue.close());
```

- [ ] **Step 2: Automation worker**

Modify `startAutomationWorker()` so the closer is registered before returning:

```ts
// apps/api/src/modules/automation/automation.worker.ts — at top
import { registerCloser } from '../../shared/lib/shutdown.js';

// inside startAutomationWorker(), just before `return worker`:
  registerCloser('automation-worker', () => worker.close());
  return worker;
```

- [ ] **Step 3: Outgoing-webhook queue**

```ts
// apps/api/src/modules/webhooks/webhook-outgoing.queue.ts
import { registerCloser } from '../../shared/lib/shutdown.js';
// ... existing exports ...
registerCloser('outgoing-webhook-queue', () => outgoingWebhookQueue.close());
```

- [ ] **Step 4: Outgoing-webhook worker**

```ts
// apps/api/src/modules/webhooks/webhook-outgoing.worker.ts — at top
import { registerCloser } from '../../shared/lib/shutdown.js';

// inside startOutgoingWebhookWorker(), just before `return worker`:
  registerCloser('outgoing-webhook-worker', () => worker.close());
  return worker;
```

- [ ] **Step 5: OAuth maintenance worker**

```ts
// apps/api/src/modules/auth/oauth/workers/oauth-maintenance.worker.ts — at top
import { registerCloser } from '../../../../shared/lib/shutdown.js';

// inside startOAuthMaintenanceWorker(), just before the final `return { queue, worker }`:
  registerCloser('oauth-maintenance-worker', () => worker.close());
  registerCloser('oauth-maintenance-queue',  () => queue.close());
  return { queue, worker };
```

- [ ] **Step 6: Compile-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/automation/automation.queue.ts \
        apps/api/src/modules/automation/automation.worker.ts \
        apps/api/src/modules/webhooks/webhook-outgoing.queue.ts \
        apps/api/src/modules/webhooks/webhook-outgoing.worker.ts \
        apps/api/src/modules/auth/oauth/workers/oauth-maintenance.worker.ts
git commit -m "feat(api): register BullMQ queues and workers with shutdown"
```

---

### Task 6: Wire SIGTERM / SIGINT in `server.ts`

**Files:**
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Append handlers**

Add at the very end of the `if (process.env.NODE_ENV !== 'test')` block (after the `serve({...})` call):

```ts
// apps/api/src/server.ts — at top of imports
import { runShutdown } from './shared/lib/shutdown.js';

// at the end of the `if (process.env.NODE_ENV !== 'test') { ... }` block:
  const onSignal = (signal: NodeJS.Signals) => {
    runShutdown(signal).finally(() => process.exit(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT',  onSignal);
```

- [ ] **Step 2: Sanity-check the dev server**

Run: `cd apps/api && npm run dev`
Send `Ctrl+C`. Expected log lines (order may vary slightly):

```
shutdown: shutdown begin
shutdown: closer ok name=oauth-maintenance-queue
shutdown: closer ok name=oauth-maintenance-worker
shutdown: closer ok name=outgoing-webhook-worker
shutdown: closer ok name=outgoing-webhook-queue
shutdown: closer ok name=automation-worker
shutdown: closer ok name=automation-queue
shutdown: closer ok name=mssql-pool
shutdown: closer ok name=redis
shutdown: shutdown complete
```

(OAuth lines are skipped if `OAUTH_TOKEN_ENC_KEY_PRIMARY` is unset.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): graceful shutdown on SIGTERM/SIGINT"
```

---

## Phase 2 — Cap the in-memory rate-limit fallback

### Task 7: Bound `memStore`

**Files:**
- Modify: `apps/api/src/shared/middleware/rateLimiter.middleware.ts`

- [ ] **Step 1: Add a hard cap and eviction**

Add immediately after the `const memStore = new Map<…>()` declaration (around line 19):

```ts
// apps/api/src/shared/middleware/rateLimiter.middleware.ts
const MEM_STORE_MAX = 50_000;

function evictIfOverCap() {
  if (memStore.size <= MEM_STORE_MAX) return;
  // Evict the 10% with the soonest resetAt — they would expire next anyway.
  const target = Math.floor(MEM_STORE_MAX * 0.1);
  const oldest = [...memStore.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, target);
  for (const [k] of oldest) memStore.delete(k);
}
```

Then inside `getCount`, after the `memStore.set(key, ...)` line in the new-key branch:

```ts
  if (!existing || now >= existing.resetAt) {
    memStore.set(key, { count: 1, resetAt: now + windowMs });
    evictIfOverCap();
    return { count: 1, resetIn: windowSec };
  }
```

- [ ] **Step 2: Export the cap for tests**

At the bottom of the same file:

```ts
export const _testing = { memStore, MEM_STORE_MAX, evictIfOverCap };
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shared/middleware/rateLimiter.middleware.ts
git commit -m "fix(api): cap rate-limiter in-memory fallback at 50k entries"
```

---

### Task 8: Test the cap

**Files:**
- Create: `apps/api/src/shared/middleware/__tests__/rateLimiter.unit.test.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/api/src/shared/middleware/__tests__/rateLimiter.unit.test.ts
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
```

- [ ] **Step 2: Run and confirm pass**

Run: `cd apps/api && npx vitest run --project unit src/shared/middleware/__tests__/rateLimiter.unit.test.ts`
Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shared/middleware/__tests__/rateLimiter.unit.test.ts
git commit -m "test(api): cover rate-limiter memStore eviction"
```

---

## Phase 3 — Cap response-cache body size

### Task 9: Skip caching oversized bodies

**Files:**
- Modify: `apps/api/src/shared/middleware/responseCache.middleware.ts`

- [ ] **Step 1: Add the cap and the guard**

Near the top of the file, after the imports:

```ts
// apps/api/src/shared/middleware/responseCache.middleware.ts
/** Don't waste Redis on multi-MB responses (reports, big search dumps). */
const MAX_CACHE_BODY_BYTES = 256 * 1024;
```

Replace the cache-miss write block (currently lines 86-99):

```ts
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
```

- [ ] **Step 2: Export for tests**

```ts
export const _testing = { MAX_CACHE_BODY_BYTES };
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shared/middleware/responseCache.middleware.ts
git commit -m "fix(api): skip response cache for bodies over 256 KB"
```

---

### Task 10: Test the body-size guard

**Files:**
- Create: `apps/api/src/shared/middleware/__tests__/responseCache.unit.test.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/api/src/shared/middleware/__tests__/responseCache.unit.test.ts
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
```

- [ ] **Step 2: Run and confirm pass**

Run: `cd apps/api && npx vitest run --project unit src/shared/middleware/__tests__/responseCache.unit.test.ts`
Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shared/middleware/__tests__/responseCache.unit.test.ts
git commit -m "test(api): cover response-cache body-size guard"
```

---

## Phase 4 — Cap outgoing-webhook response read

### Task 11: Stream-bounded read in `deliverWebhook`

**Files:**
- Modify: `apps/api/src/modules/webhooks/webhook-outgoing.dispatcher.ts`

- [ ] **Step 1: Replace `await res.text()` with a bounded reader**

Add the helper and update the call site:

```ts
// apps/api/src/modules/webhooks/webhook-outgoing.dispatcher.ts

/** Read up to `max` bytes from a Response body, then cancel the stream. */
async function readBounded(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = max - total;
      const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

// inside deliverWebhook(...), replace:
//   const responseBody = await res.text().catch(() => '');
// with:
    const responseBody = await readBounded(res, 64 * 1024).catch(() => '');
```

`responseBody.slice(0, 2000)` already truncates the log payload — leave that line as-is.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/webhooks/webhook-outgoing.dispatcher.ts
git commit -m "fix(api): cap outgoing webhook response read at 64 KB"
```

---

### Task 12: Test the bounded read

**Files:**
- Create: `apps/api/src/modules/webhooks/__tests__/webhook-outgoing.dispatcher.unit.test.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/api/src/modules/webhooks/__tests__/webhook-outgoing.dispatcher.unit.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverWebhook } from '../webhook-outgoing.dispatcher.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('deliverWebhook body cap', () => {
  it('truncates large server responses before storing', async () => {
    const big = 'A'.repeat(1024 * 1024); // 1 MB
    globalThis.fetch = vi.fn(async () =>
      new Response(big, { status: 200 }),
    ) as any;

    const result = await deliverWebhook(
      'http://example.test/hook',
      'secret',
      'task.created',
      { id: '1' },
    );

    // The dispatcher additionally slice()s to 2000 chars for the log row.
    expect(result.responseBody.length).toBeLessThanOrEqual(2000);
    expect(result.success).toBe(true);
  });

  it('returns the small body verbatim', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('ok', { status: 200 }),
    ) as any;
    const result = await deliverWebhook('http://x/h', 's', 'e', {});
    expect(result.responseBody).toBe('ok');
  });
});
```

- [ ] **Step 2: Run and confirm pass**

Run: `cd apps/api && npx vitest run --project unit src/modules/webhooks/__tests__/webhook-outgoing.dispatcher.unit.test.ts`
Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/webhooks/__tests__/webhook-outgoing.dispatcher.unit.test.ts
git commit -m "test(api): cover outgoing webhook bounded response read"
```

---

## Phase 5 — Redis-backed GraphQL pubsub

This phase introduces a new dependency. Defer it if you'd rather ship Phases 1–4 first; the in-memory pubsub keeps working until you flip the switch.

### Task 13: Add the dependency

**Files:**
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install**

Run: `cd apps/api && npm install @graphql-yoga/redis-event-target`
Expected: dependency line appears under `"dependencies"`.

- [ ] **Step 2: Commit**

```bash
git add apps/api/package.json package-lock.json
git commit -m "chore(api): add @graphql-yoga/redis-event-target"
```

---

### Task 14: Switch `pubsub.ts` to Redis-backed event target

**Files:**
- Modify: `apps/api/src/graphql/pubsub.ts`

- [ ] **Step 1: Replace the file body**

```ts
// apps/api/src/graphql/pubsub.ts
import { createPubSub } from 'graphql-yoga';
import { createRedisEventTarget } from '@graphql-yoga/redis-event-target';
import Redis from 'ioredis';
import { subLogger } from '../shared/lib/logger.js';
import { registerCloser } from '../shared/lib/shutdown.js';

const log = subLogger('pubsub');

export type PubSubChannels = {
  'task:updated':    [{ projectId: string; task: unknown }];
  'comment:created': [{ taskId: string;   comment: unknown }];
};

/**
 * GraphQL pubsub.
 *
 *   - When REDIS_URL is set (production / staging), pub and sub are routed
 *     through a dedicated pair of ioredis connections. SSE disconnects no
 *     longer leak in-memory listeners — Redis handles fan-out.
 *   - When REDIS_URL is empty (unit tests, ad-hoc dev), we fall back to
 *     in-memory pubsub.
 *
 * We use DEDICATED connections (not the shared `getRedis()` client) because
 * a Redis subscriber connection cannot run any other commands once
 * SUBSCRIBE is issued.
 */
function build() {
  const url = process.env.REDIS_URL;
  if (!url) {
    log.info('using in-memory pubsub (REDIS_URL unset)');
    return createPubSub<PubSubChannels>();
  }
  const publishClient   = new Redis(url, { lazyConnect: false });
  const subscribeClient = new Redis(url, { lazyConnect: false });

  registerCloser('pubsub-pub', () => publishClient.quit().catch(() => publishClient.disconnect()));
  registerCloser('pubsub-sub', () => subscribeClient.quit().catch(() => subscribeClient.disconnect()));

  const eventTarget = createRedisEventTarget({ publishClient, subscribeClient });
  log.info('using redis-backed pubsub');
  return createPubSub<PubSubChannels>({ eventTarget });
}

export const pubsub = build();
```

- [ ] **Step 2: Compile-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test with the dev server**

Run: `cd apps/api && npm run dev`
Open the GraphQL Playground at http://localhost:3001/api/v1/graphql and run any subscription, then disconnect. The log should print `pubsub: using redis-backed pubsub` at startup.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/graphql/pubsub.ts
git commit -m "feat(api): redis-backed graphql pubsub with in-memory dev fallback"
```

---

## Phase 6 — Final verification

### Task 15: Run the full unit suite

- [ ] **Step 1: Run from the repo root**

Run: `npm test`
Expected: all unit suites pass (per-package vitest run via turbo).

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: clean tsc / next build.

- [ ] **Step 3: Manual restart check**

In one terminal: `cd apps/api && npm run dev`.
In another: `curl http://localhost:3001/api/v1/health` — expect 200.
Back in terminal one: `Ctrl+C`. Expect the shutdown log sequence from Task 6, Step 2.

- [ ] **Step 4: Tag the cleanup**

```bash
git tag mem-leak-fixes-2026-05-18
```

---

## Out of scope (deliberate)

- Replacing the in-memory `audit-snapshots` registry — bounded by resource type count, not a leak.
- Bounding `responseCache` total Redis key count — Redis already enforces TTL and `maxmemory-policy`; out-of-band.
- Rate-limiter `setInterval` sweep tuning — current cadence is correct; only the storage was unbounded.
- Frontend changes — sampled `useEffect` cleanups across `apps/next-web` and found no leaks.

---

## Rollout order

1. Phases 1–4 are independent; you can ship them in any order, but doing Phase 1 first means the others can be exercised under `Ctrl+C` without leaking.
2. Phase 5 introduces a new dep and a config branch — ship it on its own commit so you can revert cleanly if `@graphql-yoga/redis-event-target` misbehaves with your graphql-yoga version.
3. Tag and merge after Task 15 passes locally.
