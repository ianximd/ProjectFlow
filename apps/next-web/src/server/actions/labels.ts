'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';


export interface CreateLabelInput {
  projectId: string;
  name:      string;
  color:     string;
}

export interface UpdateLabelInput {
  name?:  string;
  color?: string;
}

/** POST /labels */
export async function createLabel(input: CreateLabelInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/labels', {
      method: 'POST',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** PATCH /labels/:id */
export async function updateLabel(id: string, input: UpdateLabelInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/labels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** DELETE /labels/:id — projectId enables the API's server-side cache invalidation. */
export async function deleteLabel(id: string, projectId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(
      `/labels/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}
