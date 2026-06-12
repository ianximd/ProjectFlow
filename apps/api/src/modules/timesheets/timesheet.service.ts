import { TimesheetRepository } from './timesheet.repository.js';
import type { Timesheet, TimesheetAggregate, TimesheetStatus, TimesheetAggregateRow, TimesheetAggregateTotals } from '@projectflow/types';

const repo = new TimesheetRepository();

/** Legal status transitions for the submit/approve workflow. */
const ALLOWED: Record<TimesheetStatus, TimesheetStatus[]> = {
  draft:     ['submitted'],
  rejected:  ['submitted'],
  submitted: ['approved', 'rejected'],
  approved:  [],
};

export class TimesheetTransitionError extends Error {
  constructor(public from: TimesheetStatus, public to: TimesheetStatus) {
    super(`Illegal timesheet transition ${from} → ${to}`);
    this.name = 'TimesheetTransitionError';
  }
}

export function canTransition(from: TimesheetStatus, to: TimesheetStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(from: TimesheetStatus, to: TimesheetStatus): void {
  if (!canTransition(from, to)) throw new TimesheetTransitionError(from, to);
}

/** Pure: total/billable/non-billable across aggregate rows. Used by the grid + tests. */
export function sumAggregateRows(rows: TimesheetAggregateRow[]): TimesheetAggregateTotals {
  return rows.reduce<TimesheetAggregateTotals>(
    (acc, r) => ({
      totalSeconds:       acc.totalSeconds + r.totalSeconds,
      billableSeconds:    acc.billableSeconds + r.billableSeconds,
      nonBillableSeconds: acc.nonBillableSeconds + r.nonBillableSeconds,
    }),
    { totalSeconds: 0, billableSeconds: 0, nonBillableSeconds: 0 },
  );
}

export const timesheetService = {
  getOrCreate: (workspaceId: string, userId: string, periodStart: string, periodEnd: string): Promise<Timesheet> =>
    repo.getOrCreate(workspaceId, userId, periodStart, periodEnd),

  getById: (id: string): Promise<Timesheet | null> => repo.getById(id),

  list: (workspaceId: string, userId: string): Promise<Timesheet[]> => repo.list(workspaceId, userId),

  aggregate: (id: string): Promise<TimesheetAggregate> => repo.aggregate(id),

  submit: (id: string, userId: string, note: string | null): Promise<Timesheet | null> =>
    repo.submit(id, userId, note),

  review: (id: string, reviewerId: string, decision: 'approved' | 'rejected', note: string | null): Promise<Timesheet | null> =>
    repo.review(id, reviewerId, decision, note),
};
