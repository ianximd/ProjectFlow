import { describe, it, expect } from 'vitest';
import { sumAggregateRows } from '../timesheet.service.js';

describe('sumAggregateRows', () => {
  it('sums total/billable/non-billable across rows', () => {
    const totals = sumAggregateRows([
      { workDate: '2026-06-02', taskId: 'a', taskTitle: 'A', totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 },
      { workDate: '2026-06-03', taskId: 'b', taskTitle: 'B', totalSeconds: 1800, billableSeconds: 0,    nonBillableSeconds: 1800 },
    ]);
    expect(totals).toEqual({ totalSeconds: 5400, billableSeconds: 3600, nonBillableSeconds: 1800 });
  });
  it('empty rows → all zero', () => {
    expect(sumAggregateRows([])).toEqual({ totalSeconds: 0, billableSeconds: 0, nonBillableSeconds: 0 });
  });
});
