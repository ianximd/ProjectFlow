'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export async function createEpic(input: {
  workspaceId: string;
  projectId: string;
  title: string;
  priority: string;
  dueDate?: string | null;
}): Promise<ActionResult> {
  await requireSession();
  try {
    // Convert YYYY-MM-DD date string to ISO timestamp, matching the original page behaviour.
    const dueDate = input.dueDate ? new Date(input.dueDate).toISOString() : null;
    await serverFetch('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title:       input.title,
        type:        'EPIC',
        priority:    input.priority,
        projectId:   input.projectId,
        workspaceId: input.workspaceId,
        dueDate,
      }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/epics');
  return { ok: true };
}
