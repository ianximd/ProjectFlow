'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export async function updateTaskDates(
  taskId: string,
  input: {
    startDate?: string | null;
    dueDate?: string | null;
    clearStartDate?: boolean;
    clearDueDate?: boolean;
  },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/roadmap/tasks/${encodeURIComponent(taskId)}/dates`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/roadmap');
  return { ok: true };
}
