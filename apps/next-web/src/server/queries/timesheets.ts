import 'server-only';
import { serverFetch } from '../api';
import type { Timesheet, TimesheetAggregate } from '@projectflow/types';

/**
 * GET /timesheets?workspaceId=&periodStart=&periodEnd= — with both period bounds
 * this get-or-creates the caller's draft envelope for that week and returns it.
 */
export async function getTimesheetForPeriod(
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Timesheet> {
  const qs = new URLSearchParams({ workspaceId, periodStart, periodEnd });
  return serverFetch<Timesheet>(`/timesheets?${qs.toString()}`);
}

/** GET /timesheets/:id/aggregate — day×task rollup with billable split. */
export async function getTimesheetAggregate(id: string): Promise<TimesheetAggregate> {
  return serverFetch<TimesheetAggregate>(`/timesheets/${encodeURIComponent(id)}/aggregate`);
}

/**
 * Does the caller hold `timesheet.approve` in this workspace? Drives whether the
 * reviewer (approve/reject) panel renders. `/auth/me/permissions` is auth-only
 * (never 403), so this never trips the permission gate — workspace-member gets
 * read+submit only, owner/admin additionally get approve.
 */
export async function canApproveTimesheets(workspaceId: string): Promise<boolean> {
  try {
    const qs = new URLSearchParams({ workspaceId });
    const data = await serverFetch<{ permissions?: string[] }>(`/auth/me/permissions?${qs.toString()}`);
    return (data.permissions ?? []).includes('timesheet.approve');
  } catch {
    return false;
  }
}
