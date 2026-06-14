import { describe, it, expect, vi } from 'vitest';
import { runDueWith } from '../scheduled-report.service.js';

function makeDeps(insertedSequence: boolean[]) {
  let call = 0;
  return {
    snapshot:  vi.fn(async () => ({ scheduleId: 's1', dashboardId: 'd1', periodKey: 'p', generatedAt: 'now', cards: [] })),
    recordRun: vi.fn(async () => ({ inserted: insertedSequence[call++] ?? false, run: { id: 'r1' } as any })),
    deliver:   vi.fn(async () => undefined),
    advance:   vi.fn(async () => null),
  };
}

describe('runDueWith (per-period idempotency)', () => {
  const schedule = {
    id: 's1', dashboardId: 'd1', ownerId: 'u1', enabled: true,
    cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: ['u2'],
    nextRunAt: '2026-06-08T09:00:00.000Z',
  } as any;

  it('delivers exactly once on the first run for a period', async () => {
    const deps = makeDeps([true]);
    await runDueWith(schedule, new Date('2026-06-08T09:00:00.000Z'), deps as any);
    expect(deps.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.advance).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-deliver when the same period was already recorded (worker restart)', async () => {
    const deps = makeDeps([false]);
    await runDueWith(schedule, new Date('2026-06-08T09:00:00.000Z'), deps as any);
    expect(deps.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.advance).toHaveBeenCalledTimes(1);
  });
});
