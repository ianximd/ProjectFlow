'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch, serverFetchEnvelope } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type {
  DependencyRelation,
  TaskDependencyLists,
  TaskDependencyRef,
} from '@projectflow/types';

// Dependency edits surface anywhere a task is listed — refresh every list route,
// matching the watchers/tasks action pattern.
const TASK_LIST_PATHS = ['/board', '/backlog', '/dashboard', '/roadmap', '/epics'];

/** Client-callable loader for the Dependencies section (mirrors loadTaskWatchers). */
export async function loadTaskDependencies(taskId: string): Promise<TaskDependencyLists> {
  await requireSession();
  try {
    return (
      (await serverFetch<TaskDependencyLists>(
        `/tasks/${encodeURIComponent(taskId)}/dependencies`,
      )) ?? { waitingOn: [], blocking: [] }
    );
  } catch {
    return { waitingOn: [], blocking: [] };
  }
}

/** POST /tasks/:id/dependencies { dependsOnId, relation } — link a task. */
export async function addTaskDependency(
  taskId: string,
  dependsOnId: string,
  relation: DependencyRelation,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/tasks/${encodeURIComponent(taskId)}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnId, relation }),
    });
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}

/** DELETE /tasks/:id/dependencies/:otherId?relation= — unlink a task. */
export async function removeTaskDependency(
  taskId: string,
  otherId: string,
  relation: DependencyRelation,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(
      `/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(otherId)}?relation=${relation}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}

/** A trimmed task row for the dependency picker. */
export interface DependencyCandidate {
  id: string;
  issueKey: string | null;
  title: string;
  status: string;
}

/**
 * Search tasks by title for the dependency picker. Reuses the workspace-scoped
 * `GET /search` endpoint (the same one the global task search uses). Returns an
 * empty list on any failure so the picker degrades gracefully.
 */
export async function searchTasksForDependency(
  workspaceId: string,
  query: string,
): Promise<DependencyCandidate[]> {
  await requireSession();
  const q = query.trim();
  if (!q) return [];
  try {
    const qs = new URLSearchParams({ workspaceId, q, pageSize: '15' });
    const { data } = await serverFetchEnvelope<any[]>(`/search?${qs}`);
    return (data ?? []).map((t) => ({
      id: (t.id ?? t.Id) as string,
      issueKey: (t.issueKey ?? t.IssueKey ?? null) as string | null,
      title: (t.title ?? t.Title ?? '') as string,
      status: (t.status ?? t.Status ?? '') as string,
    }));
  } catch {
    return [];
  }
}

// Re-exported for component typing convenience.
export type { TaskDependencyRef, TaskDependencyLists, DependencyRelation };
