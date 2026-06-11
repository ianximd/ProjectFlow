'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch, serverFetchBody } from '../api';
import { toActionError } from './error';
import { getWorkLogs } from '../queries/worklogs';
import type { WorkLogListResult, WorkLog, TaskTimeRollup } from '@projectflow/types';
import type { ActionResult } from './result';

// Worklog time can surface as totals on list views — keep them fresh.
function revalidateWorkLogViews(): void {
  revalidatePath('/board');
  revalidatePath('/backlog');
}

export interface AddWorkLogInput {
  timeSpentSeconds: number;
  startedAt:        string; // ISO 8601
  description?:     string;
  endedAt?:         string;
  billable?:        boolean;
  source?:          'manual' | 'range' | 'timer';
  tagIds?:          string[];
}

export interface EditWorkLogInput {
  timeSpentSeconds?: number;
  description?:      string;
  startedAt?:        string;
  billable?:         boolean;
  tagIds?:           string[];
}

/** POST /worklogs */
export async function addWorkLog(taskId: string, input: AddWorkLogInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/worklogs', {
      method: 'POST',
      body:   JSON.stringify({ taskId, ...input }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidateWorkLogViews();
  return { ok: true };
}

/** PATCH /worklogs/:id */
export async function editWorkLog(id: string, input: EditWorkLogInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/worklogs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidateWorkLogViews();
  return { ok: true };
}

/** DELETE /worklogs/:id */
export async function deleteWorkLog(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/worklogs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidateWorkLogViews();
  return { ok: true };
}

/** Server-action refetch wrapper for the converted client component. */
export async function loadWorkLogs(taskId: string): Promise<WorkLogListResult> {
  await requireSession();
  return getWorkLogs(taskId);
}

export interface TaskRollupResult extends TaskTimeRollup {
  estimateVsActual: {
    taskId: string; loggedSeconds: number; estimateSeconds: number;
    ratio: number | null; remainingSeconds: number | null; overBudget: boolean;
  };
}

/** GET /worklogs/timer/active → the running timer (or null). */
export async function getActiveTimer(): Promise<WorkLog | null> {
  await requireSession();
  const body = await serverFetchBody<{ log: WorkLog | null }>('/worklogs/timer/active');
  return body?.log ?? null;
}

/** POST /worklogs/timer/start → returns the started (running) log. */
export async function startTimer(taskId: string): Promise<ActionResult<WorkLog>> {
  await requireSession();
  try {
    const body = await serverFetchBody<{ log: WorkLog }>('/worklogs/timer/start', {
      method: 'POST', body: JSON.stringify({ taskId }),
    });
    revalidateWorkLogViews();
    return { ok: true, data: body.log };
  } catch (e) { return toActionError(e); }
}

/** POST /worklogs/timer/stop → returns the stopped log (or null if none was running). */
export async function stopTimer(): Promise<ActionResult<WorkLog | null>> {
  await requireSession();
  try {
    const body = await serverFetchBody<{ log: WorkLog | null }>('/worklogs/timer/stop', {
      method: 'POST', body: JSON.stringify({}),
    });
    revalidateWorkLogViews();
    return { ok: true, data: body?.log ?? null };
  } catch (e) { return toActionError(e); }
}

/** PUT /worklogs/tasks/:taskId/estimate → returns the updated rollup. */
export async function setEstimate(taskId: string, estimateSeconds: number | null, perAssignee = false): Promise<ActionResult<TaskRollupResult>> {
  await requireSession();
  try {
    const body = await serverFetchBody<{ rollup: TaskRollupResult }>(
      `/worklogs/tasks/${encodeURIComponent(taskId)}/estimate`,
      { method: 'PUT', body: JSON.stringify({ estimateSeconds, perAssignee }) },
    );
    revalidateWorkLogViews();
    return { ok: true, data: body.rollup };
  } catch (e) { return toActionError(e); }
}

/** GET /worklogs/tasks/:taskId/rollup → logged/estimate rollup + estimate-vs-actual (or null). */
export async function getRollup(taskId: string): Promise<TaskRollupResult | null> {
  await requireSession();
  const body = await serverFetchBody<{ rollup: TaskRollupResult | null }>(
    `/worklogs/tasks/${encodeURIComponent(taskId)}/rollup`,
  );
  return body?.rollup ?? null;
}
