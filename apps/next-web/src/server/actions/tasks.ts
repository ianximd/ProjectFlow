'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
export type { ActionResult };

/** Run a task mutation: gate the session, call the API, revalidate the affected
 *  routes, and map any thrown ApiError into an ActionFail (rethrowing Next
 *  redirect/notFound control flow). */
async function run(fn: () => Promise<unknown>, paths: string[]): Promise<ActionResult> {
  await requireSession();
  try {
    await fn();
  } catch (e) {
    return toActionError(e);
  }
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

export interface CreateTaskInput {
  title:       string;
  projectId:   string;
  workspaceId: string;
  /** Backlog: drop the issue into a sprint section instead of the backlog. */
  sprintId?:   string | null;
}

/** PATCH /tasks/:id/position — drag-end persistence (Board). */
export async function reorderTask(id: string, position: number, status?: string): Promise<ActionResult> {
  return run(
    () => serverFetch(`/tasks/${encodeURIComponent(id)}/position`, {
      method: 'PATCH',
      body:   JSON.stringify(status ? { position, status } : { position }),
    }),
    ['/board'],
  );
}

// Not using run(): we need the created task's id from the response body to place
// the card in a non-default column (see board handleAdd).
/** POST /tasks — create an issue (Board column or Backlog/sprint section).
 *  Returns the new task's id so callers can follow up with a position/status
 *  move (the create endpoint does not accept `status` in its Zod schema, so
 *  placing a card in a non-default column requires a separate PATCH). */
export async function createTask(input: CreateTaskInput): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  let created: { id?: string } = {};
  const body: Record<string, unknown> = {
    title:       input.title,
    projectId:   input.projectId,
    workspaceId: input.workspaceId,
  };
  if (input.sprintId) body.sprintId = input.sprintId;
  try {
    created = (await serverFetch<{ id: string }>('/tasks', { method: 'POST', body: JSON.stringify(body) })) ?? {};
  } catch (e) {
    return toActionError(e);
  }
  for (const p of ['/board', '/backlog']) revalidatePath(p);
  return { ok: true, data: { id: created.id ?? '' } };
}

/** DELETE /tasks/:id */
export async function deleteTask(id: string): Promise<ActionResult> {
  return run(
    () => serverFetch(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    ['/board', '/backlog'],
  );
}

/** PATCH /tasks/:id { priority } */
export async function updateTaskPriority(id: string, priority: string): Promise<ActionResult> {
  return run(
    () => serverFetch(`/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify({ priority }),
    }),
    ['/backlog', '/board'],
  );
}
