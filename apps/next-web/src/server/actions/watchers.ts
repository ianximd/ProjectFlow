'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { TaskWatcher } from '@projectflow/types';

const TASK_LIST_PATHS = ['/board', '/backlog', '/dashboard', '/roadmap', '/epics'];

export async function loadTaskWatchers(taskId: string): Promise<TaskWatcher[]> {
  await requireSession();
  try {
    return (await serverFetch<TaskWatcher[]>(`/tasks/${encodeURIComponent(taskId)}/watchers`)) ?? [];
  } catch {
    return [];
  }
}

export async function addWatcher(taskId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/tasks/${encodeURIComponent(taskId)}/watchers/${encodeURIComponent(userId)}`, { method: 'POST' });
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}

export async function removeWatcher(taskId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/tasks/${encodeURIComponent(taskId)}/watchers/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  for (const p of TASK_LIST_PATHS) revalidatePath(p);
  return { ok: true };
}
