import { describe, it, expect } from 'vitest';
import type { Timesheet, TimesheetStatus, TimesheetAggregate } from '@projectflow/types';

describe('timesheet types', () => {
  it('a draft timesheet object satisfies the Timesheet shape', () => {
    const ts: Timesheet = {
      id: 't1', workspaceId: 'w1', userId: 'u1',
      periodStart: '2026-06-01', periodEnd: '2026-06-07',
      status: 'draft' as TimesheetStatus,
      submittedAt: null, reviewedById: null, reviewedAt: null, note: null,
      createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    };
    expect(ts.status).toBe('draft');
  });

  it('an aggregate carries rows and totals', () => {
    const agg: TimesheetAggregate = {
      rows: [{ workDate: '2026-06-02', taskId: 'k1', taskTitle: 'A',
               totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 }],
      totals: { totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 },
    };
    expect(agg.rows[0].billableSeconds).toBe(3600);
  });
});
