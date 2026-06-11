'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type {
  Whiteboard,
  CreateWhiteboardInput,
  ConvertShapeToTaskInput,
  ConvertShapeToTaskResult,
} from '@projectflow/types';

/**
 * POST /whiteboards/:id/convert-to-task — mint a Task in the target List from a
 * tldraw shape. The API returns `{ data: { task, link } }` (201); serverFetch
 * unwraps `.data`, so `result` IS the ConvertShapeToTaskResult.
 *
 * `input` carries { targetListId, shapeId, shape } exactly as the convertSchema
 * validator expects (whiteboard.routes.ts:24).
 */
export async function convertShapeToTask(
  whiteboardId: string,
  input: ConvertShapeToTaskInput,
): Promise<ActionResult<ConvertShapeToTaskResult>> {
  await requireSession();
  let result: ConvertShapeToTaskResult;
  try {
    result = await serverFetch<ConvertShapeToTaskResult>(
      `/whiteboards/${encodeURIComponent(whiteboardId)}/convert-to-task`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  } catch (e) {
    return toActionError(e);
  }
  // The new task can surface on board/backlog list views.
  revalidatePath('/board');
  revalidatePath('/backlog');
  // Refresh the SSR links panel on the whiteboard page itself.
  revalidatePath(`/whiteboards/${whiteboardId}`);
  return { ok: true, data: result };
}

/** POST /whiteboards — create a board in a scope. */
export async function createWhiteboard(
  input: CreateWhiteboardInput,
): Promise<ActionResult<Whiteboard>> {
  await requireSession();
  let wb: Whiteboard;
  try {
    wb = await serverFetch<Whiteboard>('/whiteboards', {
      method: 'POST',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true, data: wb };
}

/** PATCH /whiteboards/:id — rename. */
export async function renameWhiteboard(id: string, name: string): Promise<ActionResult<Whiteboard>> {
  await requireSession();
  let wb: Whiteboard;
  try {
    wb = await serverFetch<Whiteboard>(`/whiteboards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify({ name }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/whiteboards/${id}`);
  return { ok: true, data: wb };
}

/** DELETE /whiteboards/:id — soft-delete. */
export async function deleteWhiteboard(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/whiteboards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}
