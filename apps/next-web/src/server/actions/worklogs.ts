'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { getWorkLogs } from '../queries/worklogs';
import type { WorkLogListResult } from '@projectflow/types';
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
}

export interface EditWorkLogInput {
  timeSpentSeconds?: number;
  description?:      string;
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
