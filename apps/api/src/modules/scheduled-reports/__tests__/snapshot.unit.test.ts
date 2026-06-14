import { describe, it, expect, vi } from 'vitest';
import { snapshotWith } from '../scheduled-report.service.js';

describe('snapshotWith (snapshot freezes card data)', () => {
  it('resolves every card once under the owner and freezes the result', async () => {
    let liveValue = 10;
    const cards = [
      { id: 'c1', dashboardId: 'd1', type: 'calculation', title: 'Open', config: {}, layout: {}, position: 0 },
      { id: 'c2', dashboardId: 'd1', type: 'bar',         title: 'By status', config: {}, layout: {}, position: 1 },
    ];
    const dash = { id: 'd1', workspaceId: 'w1', ownerId: 'u1', scopeType: 'workspace', scopeId: null, name: 'D', cards };
    const deps = {
      getDashboard: vi.fn(async () => dash),
      assertAccess: vi.fn(async () => {}),
      resolveCard:  vi.fn(async (card: any) => ({ cardId: card.id, type: card.type, shape: 'scalar', data: { value: liveValue } })),
    };
    const schedule = { id: 's1', dashboardId: 'd1', ownerId: 'u1', workspaceId: 'w1', cadence: { freq: 'daily', interval: 1 } } as any;

    const snap = await snapshotWith(schedule, '2026-06-08T09:00:00.000Z', deps as any);

    // access gate runs once, BEFORE any card resolves
    expect(deps.assertAccess).toHaveBeenCalledTimes(1);
    expect(deps.resolveCard).toHaveBeenCalledTimes(2);
    // resolved under the OWNER's id
    expect(deps.resolveCard).toHaveBeenCalledWith(cards[0], dash, 'u1');
    expect(snap.cards).toHaveLength(2);
    expect((snap.cards[0].data as any).data.value).toBe(10);

    // Mutating the live source AFTER the snapshot must NOT change the frozen payload.
    liveValue = 999;
    expect((snap.cards[0].data as any).data.value).toBe(10);
    expect(snap.periodKey).toBe('2026-06-08T09:00:00.000Z');
  });

  it('fails CLOSED: when assertAccess throws, NO card is resolved (no leaked snapshot)', async () => {
    const dash = { id: 'd1', workspaceId: 'wOTHER', ownerId: 'u1', scopeType: 'workspace', scopeId: null, name: 'D', cards: [{ id: 'c1', type: 'calculation' }] };
    const deps = {
      getDashboard: vi.fn(async () => dash),
      assertAccess: vi.fn(async () => { throw new Error('SCHEDULE_FORBIDDEN'); }),
      resolveCard:  vi.fn(async () => ({ cardId: 'c1', type: 'calculation', shape: 'scalar', data: {} })),
    };
    const schedule = { id: 's1', dashboardId: 'd1', ownerId: 'u1', workspaceId: 'w1', cadence: { freq: 'daily', interval: 1 } } as any;

    await expect(snapshotWith(schedule, 'p', deps as any)).rejects.toThrow(/FORBIDDEN/);
    expect(deps.resolveCard).not.toHaveBeenCalled();
  });
});
