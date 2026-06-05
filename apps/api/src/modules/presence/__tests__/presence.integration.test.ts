/**
 * Presence service Redis integration tests (Phase 3.5c, Task 10).
 *
 * Proves the service's TTL semantics against a real Redis instance:
 *   - heartbeat with a given timestamp inserts the viewer into the hash
 *   - snapshot taken at now + 40 s (> PRESENCE_TTL_MS = 30 000 ms) evicts
 *     the stale entry and returns an empty list for that viewer
 *
 * `createTestUser` is used (not a raw GUID) because `presenceService.heartbeat`
 * calls `usp_User_GetDisplay` which reads the Users table — the user must exist.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { getRedis } from '../../../shared/lib/redis.js';
import { presenceService } from '../presence.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('presence service (redis)', () => {
  it('heartbeat then snapshot returns the viewer; stale entries drop after TTL', async () => {
    const taskId = '00000000-0000-0000-0000-0000000000aa';
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const u = await createTestUser({ email: `presence-${stamp}@projectflow.test` });
    const uid = u.user.Id;

    // Clean up any prior state for this taskId so the test is deterministic.
    await getRedis().del(`presence:task:${taskId}`);

    const now = 1_000_000;

    // ── heartbeat at `now` ─────────────────────────────────────────────────
    const live = await presenceService.heartbeat(taskId, uid, true, now);

    // The viewer must appear in the returned snapshot (typing = true).
    expect(
      live.some(
        (v) => v.userId.toUpperCase() === uid.toUpperCase() && v.typing === true,
      ),
    ).toBe(true);

    // ── snapshot at now + 40 000 ms (beyond the 30 000 ms TTL window) ─────
    const later = await presenceService.snapshot(taskId, now + 40_000);

    // The stale entry must have been evicted — the viewer must NOT appear.
    expect(
      later.some((v) => v.userId.toUpperCase() === uid.toUpperCase()),
    ).toBe(false);

    // Tidy up Redis key so other tests aren't polluted.
    await getRedis().del(`presence:task:${taskId}`);
  });

  it('leave immediately removes the viewer from the snapshot', async () => {
    const taskId = '00000000-0000-0000-0000-0000000000bb';
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const u = await createTestUser({ email: `presence-leave-${stamp}@projectflow.test` });
    const uid = u.user.Id;

    await getRedis().del(`presence:task:${taskId}`);

    const now = 2_000_000;

    // Join.
    const joined = await presenceService.heartbeat(taskId, uid, false, now);
    expect(joined.some((v) => v.userId.toUpperCase() === uid.toUpperCase())).toBe(true);

    // Leave.
    const after = await presenceService.leave(taskId, uid, now);
    expect(after.some((v) => v.userId.toUpperCase() === uid.toUpperCase())).toBe(false);

    await getRedis().del(`presence:task:${taskId}`);
  });
});
