'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { RecurrenceRule, RecurrenceMode, TaskRecurrence } from '@projectflow/types';

// Recurrence edits surface anywhere a task is listed (a recurring badge on the
// card row), so refresh every list route — matching the dependencies action.
const TASK_LIST_PATHS = ['/board', '/backlog', '/dashboard', '/roadmap', '/epics'];

/**
 * Client-callable loader for the Recurrence section.
 * GET /tasks/:id/recurrence → { data: TaskRecurrence | null }.
 * Returns null on any failure so the section degrades gracefully (mirrors
 * loadTaskDependencies).
 */
export async function loadTaskRecurrence(taskId: string): Promise<TaskRecurrence | null> {
  await requireSession();
  try {
    return (await serverFetch<TaskRecurrence | null>(
      `/tasks/${encodeURIComponent(taskId)}/recurrence`,
    )) ?? null;
  } catch {
    return null;
  }
}

/**
 * PUT /tasks/:id/recurrence { rule, regenerateMode, includeDependencies? } —
 * set (create or replace) the recurrence rule. A malformed rule comes back as
 * a 422 INVALID_RECURRENCE_RULE / WORKSPACE_MISMATCH, preserved on the result
 * so the editor can surface a curated bad-rule toast.
 */
export async function setTaskRecurrence(
  taskId: string,
  input: {
    rule: RecurrenceRule;
    regenerateMode: RecurrenceMode;
    includeDependencies?: boolean;
  },
): Promise<ActionResult<TaskRecurrence>> {
  await requireSession();
  let data: TaskRecurrence;
  try {
    data = await serverFetch<TaskRecurrence>(`/tasks/${encodeURIComponent(taskId)}/recurrence`, {
      method: 'PUT',
      body: JSON.stringify({
        rule: input.rule,
        regenerateMode: input.regenerateMode,
        includeDependencies: input.includeDependencies,
      }),
    });
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true, data };
}

/** DELETE /tasks/:id/recurrence — clear the rule (idempotent, 204). */
export async function clearTaskRecurrence(taskId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/tasks/${encodeURIComponent(taskId)}/recurrence`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}
