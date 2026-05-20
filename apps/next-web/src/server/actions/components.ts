'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';


export interface CreateComponentInput {
  projectId:    string;
  name:         string;
  description:  string | null;
  leadUserId?:  string | null;
}

export interface UpdateComponentInput {
  name?:        string;
  description?: string | null;
  leadUserId?:  string | null;
}

/** POST /components */
export async function createComponent(input: CreateComponentInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/components', {
      method: 'POST',
      body:   JSON.stringify({
        projectId:   input.projectId,
        name:        input.name,
        description: input.description,
        // The create dialog has no lead field; null is the valid empty value
        // (the API rejects '' against its uuid schema).
        leadUserId:  input.leadUserId ?? null,
      }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** PATCH /components/:id */
export async function updateComponent(id: string, input: UpdateComponentInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/components/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** DELETE /components/:id — projectId enables the API's server-side cache invalidation. */
export async function deleteComponent(id: string, projectId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(
      `/components/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}
