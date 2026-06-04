'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { Tag } from '@projectflow/types';

const TASK_LIST_PATHS = ['/board', '/backlog', '/dashboard', '/roadmap', '/epics'];

/** Client-callable loaders (mirror loadTaskCustomFields). */
export async function loadSpaceTags(spaceId: string): Promise<Tag[]> {
  await requireSession();
  try {
    return (await serverFetch<Tag[]>(`/tags?spaceId=${encodeURIComponent(spaceId)}`)) ?? [];
  } catch {
    return [];
  }
}

export async function loadTaskTags(taskId: string): Promise<Tag[]> {
  await requireSession();
  try {
    return (await serverFetch<Tag[]>(`/tasks/${encodeURIComponent(taskId)}/tags`)) ?? [];
  } catch {
    return [];
  }
}

/** POST /tags */
export async function createTag(spaceId: string, name: string, color?: string | null): Promise<ActionResult<Tag>> {
  await requireSession();
  let tag: Tag | undefined;
  try {
    tag = (await serverFetch<Tag>('/tags', { method: 'POST', body: JSON.stringify({ spaceId, name, color: color ?? null }) })) ?? undefined;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true, data: tag as Tag };
}

/** DELETE /tags/:id */
export async function deleteTag(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** POST /tasks/:id/tags/:tagId */
export async function linkTag(taskId: string, tagId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}`, { method: 'POST' });
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}

/** DELETE /tasks/:id/tags/:tagId */
export async function unlinkTag(taskId: string, tagId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}
