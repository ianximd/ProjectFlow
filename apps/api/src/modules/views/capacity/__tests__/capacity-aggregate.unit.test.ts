import { describe, it, expect } from 'vitest';
import { aggregateCapacity, type RawCapacityRow } from '../capacity-aggregate.js';

const rows: RawCapacityRow[] = [
  { UserId: 'u1', Name: 'Alice', Email: 'a@x', AvatarUrl: null, AssignedSeconds: 144000, AssignedPoints: 13, TaskCount: 4 },
  { UserId: 'u2', Name: 'Bob',   Email: 'b@x', AvatarUrl: null, AssignedSeconds: 7200,   AssignedPoints: 2,  TaskCount: 1 },
];

describe('aggregateCapacity', () => {
  it('flags an over-capacity assignee in the time metric', () => {
    // capacityPerDaySeconds 28800 (8h) × 5 days = 40h capacity; Alice 144000s = 40h assigned ⇒ at-capacity
    const res = aggregateCapacity(rows, { metric: 'time', from: '2026-06-01', to: '2026-06-05', capacityPerDaySeconds: 28800, days: 5 });
    expect(res.metric).toBe('time');
    const alice = res.rows.find((r) => r.userId === 'u1')!;
    expect(alice.capacity).toBe(144000);          // 28800 * 5 days
    expect(alice.assignedSeconds).toBe(144000);
    expect(alice.status).toBe('at');              // 40h assigned vs 40h capacity
    const bob = res.rows.find((r) => r.userId === 'u2')!;
    expect(bob.status).toBe('under');
  });

  it('flags over-capacity in the points metric', () => {
    const res = aggregateCapacity(rows, { metric: 'points', from: null, to: null, capacityPerSprintPoints: 8, days: 0 });
    const alice = res.rows.find((r) => r.userId === 'u1')!;
    expect(alice.capacity).toBe(8);
    expect(alice.assignedPoints).toBe(13);
    expect(alice.status).toBe('over');
  });

  it('returns rows sorted by descending ratio so over-capacity surfaces first', () => {
    const res = aggregateCapacity(rows, { metric: 'points', from: null, to: null, capacityPerSprintPoints: 8, days: 0 });
    expect(res.rows.map((r) => r.userId)).toEqual(['u1', 'u2']);
  });

  it('time metric with days=0 falls back to a single-day capacity (documented contract)', () => {
    // No range → days=0. Per the AggregateOpts.days contract, capacity = perDaySeconds * 1.
    // (Pinning this so the fallback is visible; supplying a real range is the page's job.)
    const res = aggregateCapacity(rows, { metric: 'time', from: null, to: null, capacityPerDaySeconds: 28800, days: 0 });
    const alice = res.rows.find((r) => r.userId === 'u1')!;
    expect(alice.capacity).toBe(28800);  // 28800 * 1
    expect(alice.status).toBe('over');   // 144000s assigned ≫ 28800s (1 day)
  });

  it('returns an empty result for empty input', () => {
    const res = aggregateCapacity([], { metric: 'time', from: null, to: null, capacityPerDaySeconds: 28800, days: 5 });
    expect(res.rows).toEqual([]);
    expect(res.metric).toBe('time');
  });
});
