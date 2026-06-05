import { describe, it, expect, vi } from 'vitest';
import { computeRecipients } from '../fanout.js';

const R = 'aaaaaaaa-0000-0000-0000-000000000001'; // reporter
const X = 'aaaaaaaa-0000-0000-0000-000000000002'; // assignee
const W = 'aaaaaaaa-0000-0000-0000-000000000003'; // watcher
const ACTOR = 'aaaaaaaa-0000-0000-0000-000000000009';

describe('computeRecipients', () => {
  it('unions reporter + assignees + watchers', () => {
    const r = computeRecipients({ reporterId: R, assigneeIds: [X], watcherIds: [W], actorId: ACTOR });
    expect(r.sort()).toEqual([R, X, W].map((s) => s.toUpperCase()).sort());
  });

  it('dedupes a user appearing in multiple roles (case-insensitive)', () => {
    const r = computeRecipients({
      reporterId: R, assigneeIds: [R.toUpperCase()], watcherIds: [R.toLowerCase()], actorId: ACTOR,
    });
    expect(r).toEqual([R.toUpperCase()]);
  });

  it('excludes the actor', () => {
    const r = computeRecipients({ reporterId: ACTOR, assigneeIds: [X], watcherIds: [], actorId: ACTOR });
    expect(r).toEqual([X.toUpperCase()]);
  });

  it('excludes ids in extraExclude (e.g. already-notified mentions)', () => {
    const r = computeRecipients({ reporterId: R, assigneeIds: [X], watcherIds: [W], actorId: ACTOR, extraExclude: [X] });
    expect(r.sort()).toEqual([R, W].map((s) => s.toUpperCase()).sort());
  });

  it('handles empty/missing inputs', () => {
    expect(computeRecipients({ reporterId: null, assigneeIds: [], watcherIds: [], actorId: ACTOR })).toEqual([]);
  });
});

describe('debounceGate', () => {
  it('emits when redis SET NX succeeds, suppresses when it fails', async () => {
    vi.resetModules();
    const set = vi.fn()
      .mockResolvedValueOnce('OK')   // first call: key absent → emit
      .mockResolvedValueOnce(null);  // second call: key present → suppress
    vi.doMock('../../../shared/lib/redis.js', () => ({ getRedis: () => ({ set }) }));
    const { debounceGate } = await import('../fanout.js');
    expect(await debounceGate('k', 60)).toBe(true);
    expect(await debounceGate('k', 60)).toBe(false);
    expect(set).toHaveBeenCalledWith('k', '1', 'EX', 60, 'NX');
  });

  it('fails open (emits) when redis throws', async () => {
    vi.resetModules();
    vi.doMock('../../../shared/lib/redis.js', () => ({ getRedis: () => ({ set: vi.fn().mockRejectedValue(new Error('down')) }) }));
    const { debounceGate } = await import('../fanout.js');
    expect(await debounceGate('k', 60)).toBe(true);
  });
});
