'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { getWorkspaceProjectContext } from '../context';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { Template, TemplateScopeType } from '@projectflow/types';

// Applying a template can spawn lists/tasks/views/fields under the chosen
// parent, and capturing/deleting a template changes the workspace template set.
// The sidebar tree (rendered from the root layout) and every list surface need
// to pick that up, so refresh the hierarchy root + the list routes + the
// Template Center. Mirrors the dependencies/recurrence revalidate pattern.
const HIERARCHY_PATHS = ['/', '/templates'];
const TASK_LIST_PATHS = ['/board', '/backlog', '/dashboard', '/roadmap', '/epics'];

/** The counts an apply returns, for the success toast. */
export interface ApplyTemplateCounts {
  lists: number;
  tasks: number;
  views: number;
  fields: number;
}

/**
 * POST /templates { scopeType, sourceId, name, description? } — capture a
 * snapshot from a source node (task / list / folder / space). Returns the new
 * Template row (list rows carry no snapshot). Revalidates the Template Center.
 */
export async function createTemplate(input: {
  scopeType: TemplateScopeType;
  sourceId: string;
  name: string;
  description?: string | null;
}): Promise<ActionResult<Template>> {
  await requireSession();
  let data: Template;
  try {
    data = await serverFetch<Template>('/templates', {
      method: 'POST',
      body: JSON.stringify({
        scopeType: input.scopeType,
        sourceId: input.sourceId,
        name: input.name,
        description: input.description ?? null,
      }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/templates');
  return { ok: true, data };
}

/**
 * Client-callable loader for the workspace's templates (optionally filtered to
 * one scope). List rows omit the snapshot. Returns [] on any failure so the
 * picker / center degrade gracefully (mirrors loadTaskDependencies).
 *
 * `GET /templates` REQUIRES a workspaceId (templates are workspace-scoped), so
 * resolve the active workspace from context and pass it; without it the route
 * 400s on validation and the Template Center renders empty.
 */
export async function listTemplates(scopeType?: TemplateScopeType): Promise<Template[]> {
  await requireSession();
  const { activeWorkspaceId } = await getWorkspaceProjectContext();
  if (!activeWorkspaceId) return [];
  try {
    const params = new URLSearchParams({ workspaceId: activeWorkspaceId });
    if (scopeType) params.set('scopeType', scopeType);
    return (await serverFetch<Template[]>(`/templates?${params.toString()}`)) ?? [];
  } catch {
    return [];
  }
}

/**
 * Client-callable loader for a single template INCLUDING its snapshot (used by
 * the item-selection tree in the apply modal). Returns null on any failure.
 */
export async function getTemplate(id: string): Promise<Template | null> {
  await requireSession();
  try {
    return (await serverFetch<Template>(`/templates/${encodeURIComponent(id)}`)) ?? null;
  } catch {
    return null;
  }
}

/**
 * POST /templates/:id/apply { targetParentId, anchorDate, selectedItemIds? } —
 * materialize the template under a chosen parent, remapping snapshot date
 * offsets onto `anchorDate`. Returns the new root id + counts. Revalidates the
 * hierarchy + every list route so the new nodes appear without a manual reload.
 */
export async function applyTemplate(
  id: string,
  input: { targetParentId: string; anchorDate: string; selectedItemIds?: string[] },
): Promise<ActionResult<{ rootId: string; counts: ApplyTemplateCounts }>> {
  await requireSession();
  let data: { rootId: string; counts: ApplyTemplateCounts };
  try {
    data = await serverFetch<{ rootId: string; counts: ApplyTemplateCounts }>(
      `/templates/${encodeURIComponent(id)}/apply`,
      {
        method: 'POST',
        body: JSON.stringify({
          targetParentId: input.targetParentId,
          anchorDate: input.anchorDate,
          ...(input.selectedItemIds ? { selectedItemIds: input.selectedItemIds } : {}),
        }),
      },
    );
  } catch (e) {
    return toActionError(e);
  }
  for (const p of [...HIERARCHY_PATHS, ...TASK_LIST_PATHS]) revalidatePath(p);
  return { ok: true, data };
}

/** DELETE /templates/:id — remove a template (204). Revalidates the center. */
export async function deleteTemplate(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/templates');
  return { ok: true };
}
