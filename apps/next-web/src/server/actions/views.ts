'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { gqlData, previewViewTasks as previewViewTasksQuery, type ViewTaskPageResult } from '../queries/views';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { BulkAction, BulkUpdateResult, SavedView, ViewConfig } from '@projectflow/types';

// Saved views render on the List host route and the Board; a view mutation can
// change either, so refresh both (mirrors tasks.ts's TASK_LIST_PATHS approach).

/** Gate the session, run a GraphQL mutation, revalidate the view routes, and map
 *  any thrown ApiError into an ActionFail (rethrowing Next control flow). Mirrors
 *  the `run` helper in actions/tasks.ts. */
async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  await requireSession();
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/board');
  revalidatePath('/lists/[listId]', 'page');
  // The views surface itself renders saved views + their task pages, so a view
  // (or bulk-task) mutation must invalidate it too — without this, other clients
  // serve a stale tab row / task list from the route cache.
  revalidatePath('/views/[scopeType]/[scopeId]', 'page');
  return { ok: true, data: result } as ActionResult<T>;
}

/** Live preview of an UNSAVED `ViewConfig` against a scope, callable from the
 *  client filter-builder. Read-only, so (unlike `run`) it does NOT revalidate any
 *  routes — it just gates the session, runs the preview query, and maps a thrown
 *  ApiError into an ActionFail. Returns the same `ViewTaskPageResult` shape as the
 *  SSR `getViewTasks`/`previewViewTasks` query. */
export async function previewViewTasks(
  scopeType: SavedView['scopeType'],
  scopeId: string | null,
  config: ViewConfig,
  page = 1,
  meMode = false,
  workspaceId?: string,
): Promise<ActionResult<ViewTaskPageResult>> {
  await requireSession();
  try {
    const data = await previewViewTasksQuery(scopeType, scopeId, config, page, meMode, workspaceId);
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export interface CreateSavedViewInput {
  scopeType:    SavedView['scopeType'];
  scopeId:      string | null;
  type:         SavedView['type'];
  name:         string;
  isShared:     boolean;
  isDefault:    boolean;
  config:       ViewConfig;
  workspaceId?: string;
}

const CREATE_MUTATION = /* GraphQL */ `
  mutation CreateSavedView($input: CreateSavedViewInput!) {
    createSavedView(input: $input) { id }
  }
`;

/** Create a saved view. `config` is serialized to the JSON string the schema's
 *  String arg expects. Returns the new view's id. */
export async function createSavedView(input: CreateSavedViewInput): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { createSavedView: v } = await gqlData<{ createSavedView: { id: string } }>(CREATE_MUTATION, {
      input: {
        scopeType:   input.scopeType,
        scopeId:     input.scopeId ?? null,
        type:        input.type,
        name:        input.name,
        isShared:    input.isShared,
        isDefault:   input.isDefault,
        config:      JSON.stringify(input.config),
        workspaceId: input.workspaceId ?? null,
      },
    });
    return { id: v.id };
  });
}

export interface UpdateSavedViewInput {
  name?:      string;
  isShared?:  boolean;
  isDefault?: boolean;
  config?:    ViewConfig;
}

const UPDATE_MUTATION = /* GraphQL */ `
  mutation UpdateSavedView($id: String!, $input: UpdateSavedViewInput!) {
    updateSavedView(id: $id, input: $input) { id }
  }
`;

/** Patch a saved view's metadata and/or config (config serialized to JSON). */
export async function updateSavedView(id: string, input: UpdateSavedViewInput): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { updateSavedView: v } = await gqlData<{ updateSavedView: { id: string } }>(UPDATE_MUTATION, {
      id,
      input: {
        name:      input.name ?? null,
        isShared:  input.isShared ?? null,
        isDefault: input.isDefault ?? null,
        config:    input.config != null ? JSON.stringify(input.config) : null,
      },
    });
    return { id: v.id };
  });
}

const DELETE_MUTATION = /* GraphQL */ `
  mutation DeleteSavedView($id: String!) {
    deleteSavedView(id: $id) { id }
  }
`;

/** Delete a saved view. */
export async function deleteSavedView(id: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { deleteSavedView: v } = await gqlData<{ deleteSavedView: { id: string } }>(DELETE_MUTATION, { id });
    return { id: v.id };
  });
}

const REORDER_MUTATION = /* GraphQL */ `
  mutation ReorderSavedView($id: String!, $position: Float!) {
    reorderSavedView(id: $id, position: $position) { id position }
  }
`;

/** Reorder a saved view (drag-end persistence). */
export async function reorderSavedView(id: string, position: number): Promise<ActionResult<{ id: string; position: number }>> {
  return run(async () => {
    const { reorderSavedView: v } = await gqlData<{ reorderSavedView: { id: string; position: number } }>(REORDER_MUTATION, { id, position });
    return v;
  });
}

const BULK_UPDATE_MUTATION = /* GraphQL */ `
  mutation BulkUpdateTasks($taskIds: [String!]!, $action: String!) {
    bulkUpdateTasks(taskIds: $taskIds, action: $action) {
      updated
      failed { id reason }
    }
  }
`;

/** Apply a bulk action across a set of tasks. `action` is serialized to the JSON
 *  string the schema's String arg expects. */
export async function bulkUpdateTasks(taskIds: string[], action: BulkAction): Promise<ActionResult<BulkUpdateResult>> {
  return run(async () => {
    const { bulkUpdateTasks: r } = await gqlData<{ bulkUpdateTasks: BulkUpdateResult }>(BULK_UPDATE_MUTATION, {
      taskIds,
      action: JSON.stringify(action),
    });
    return r;
  });
}
