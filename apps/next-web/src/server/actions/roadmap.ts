'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
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
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
  revalidatePath('/roadmap');
  return { ok: true };
}
