'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch, serverFetchEnvelope } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { RelationshipRef } from '@projectflow/types';

// Relationship edits surface anywhere a task is listed (rollups recompute from
// them), so refresh every list route — matching the dependencies action.
const TASK_LIST_PATHS = ['/board', '/backlog', '/dashboard', '/roadmap', '/epics'];

/**
 * Client-callable loader for a relationship custom field's linked tasks.
 * GET /tasks/:id/relationships/:fieldId → { data: RelationshipRef[] }.
 * Returns [] on any failure so the picker degrades gracefully (mirrors
 * loadTaskDependencies).
 */
export async function loadTaskRelationships(
  taskId: string,
  fieldId: string,
): Promise<RelationshipRef[]> {
  await requireSession();
  try {
    return (
      (await serverFetch<RelationshipRef[]>(
        `/tasks/${encodeURIComponent(taskId)}/relationships/${encodeURIComponent(fieldId)}`,
      )) ?? []
    );
  } catch {
    return [];
  }
}

/** POST /tasks/:id/relationships/:fieldId { toTaskId } — link a task. */
export async function addTaskRelationship(
  taskId: string,
  fieldId: string,
  toTaskId: string,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(
      `/tasks/${encodeURIComponent(taskId)}/relationships/${encodeURIComponent(fieldId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ toTaskId }),
      },
    );
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}

/** DELETE /tasks/:id/relationships/:fieldId/:toTaskId — unlink a task. */
export async function removeTaskRelationship(
  taskId: string,
  fieldId: string,
  toTaskId: string,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(
      `/tasks/${encodeURIComponent(taskId)}/relationships/${encodeURIComponent(fieldId)}/${encodeURIComponent(toTaskId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}

/** A trimmed task row for the relationship picker (mirrors DependencyCandidate). */
export interface RelationshipCandidate {
  id: string;
  issueKey: string | null;
  title: string;
  status: string;
}

/**
 * Search tasks by title for the relationship picker. Reuses the workspace-scoped
 * `GET /search` endpoint (the same one the dependency picker uses). Returns an
 * empty list on any failure so the picker degrades gracefully.
 */
export async function searchTasksForRelationship(
  workspaceId: string,
  query: string,
): Promise<RelationshipCandidate[]> {
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

/** A list option for the relationship field-manager target-list picker. */
export interface SpaceListOption {
  id: string;
  name: string;
}

/**
 * Load the Lists in a Space for the relationship field-manager's "target list"
 * picker. Reuses `GET /lists?spaceId=` (the same endpoint the hierarchy tree
 * uses). Returns [] on any failure so the sub-form degrades to a free pick.
 */
export async function loadSpaceLists(spaceId: string): Promise<SpaceListOption[]> {
  await requireSession();
  if (!spaceId) return [];
  try {
    const data = await serverFetch<any[]>(`/lists?spaceId=${encodeURIComponent(spaceId)}`);
    return (data ?? []).map((r) => ({
      id: String(r?.Id ?? r?.id ?? ''),
      name: String(r?.Name ?? r?.name ?? ''),
    }));
  } catch {
    return [];
  }
}
