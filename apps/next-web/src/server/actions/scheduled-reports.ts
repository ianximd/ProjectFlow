'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type {
  ScheduledReport,
  ScheduledReportRun,
  ReportSnapshot,
  RecurrenceRule,
  DeliveryChannel,
} from '@projectflow/types';

// Schedules surface on the dashboard view — keep it fresh after mutations.
function revalidateScheduleViews(): void {
  revalidatePath('/dashboard');
}

export interface CreateScheduleActionInput {
  workspaceId:      string;
  dashboardId?:     string | null;
  cadence:          RecurrenceRule;
  deliveryChannel?: DeliveryChannel;
  recipients:       string[];
}

export interface UpdateSchedulePatch {
  cadence?:         RecurrenceRule;
  deliveryChannel?: DeliveryChannel;
  recipients?:      string[];
  enabled?:         boolean;
}

/** GET /scheduled-reports?workspaceId= — `{ data: schedules }` (serverFetch unwraps `.data`). */
export async function listSchedules(workspaceId: string): Promise<ActionResult<ScheduledReport[]>> {
  await requireSession();
  try {
    const data = await serverFetch<ScheduledReport[]>(
      `/scheduled-reports?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return toActionError(e);
  }
}

/** POST /scheduled-reports — `{ data: schedule }`. */
export async function createSchedule(
  input: CreateScheduleActionInput,
): Promise<ActionResult<ScheduledReport>> {
  await requireSession();
  try {
    const data = await serverFetch<ScheduledReport>('/scheduled-reports', {
      method: 'POST',
      body:   JSON.stringify(input),
    });
    revalidateScheduleViews();
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

/** PATCH /scheduled-reports/:id — `{ data: updated }`. */
export async function updateSchedule(
  id: string,
  patch: UpdateSchedulePatch,
): Promise<ActionResult<ScheduledReport>> {
  await requireSession();
  try {
    const data = await serverFetch<ScheduledReport>(
      `/scheduled-reports/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    revalidateScheduleViews();
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

/** DELETE /scheduled-reports/:id — 204 No Content. */
export async function removeSchedule(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/scheduled-reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    revalidateScheduleViews();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** GET /scheduled-reports/:id/runs?page= — `{ data: runs, meta }` (serverFetch returns `runs`). */
export async function listScheduleRuns(
  id: string,
  page = 1,
): Promise<ActionResult<ScheduledReportRun[]>> {
  await requireSession();
  try {
    const data = await serverFetch<ScheduledReportRun[]>(
      `/scheduled-reports/${encodeURIComponent(id)}/runs?page=${encodeURIComponent(String(page))}`,
    );
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return toActionError(e);
  }
}

/** GET /scheduled-reports/:id/runs/:runId/snapshot — `{ data: { run, snapshot } }`. */
export async function getRunSnapshot(
  id: string,
  runId: string,
): Promise<ActionResult<{ run: ScheduledReportRun; snapshot: ReportSnapshot | null }>> {
  await requireSession();
  try {
    const data = await serverFetch<{ run: ScheduledReportRun; snapshot: ReportSnapshot | null }>(
      `/scheduled-reports/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/snapshot`,
    );
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}
