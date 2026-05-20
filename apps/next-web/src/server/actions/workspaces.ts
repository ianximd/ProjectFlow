'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';


/** POST /workspaces — create a workspace. Refreshes the page list and the
 *  app-shell layout (sidebar workspace switcher). */
export async function createWorkspace(name: string, slug: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/workspaces', {
      method: 'POST',
      body:   JSON.stringify({ name, slug }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workspaces');
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** PATCH /workspaces/{id} — update workspace general settings. */
export async function updateWorkspace(
  id: string,
  changed: { name?: string; slug?: string; avatarUrl?: string | null },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workspaces/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(changed),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${id}/settings`);
  revalidatePath('/workspaces');
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** DELETE /workspaces/{id} — permanently delete a workspace and redirect to
 *  the workspace list on success. */
export async function deleteWorkspace(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/workspaces');
  revalidatePath('/', 'layout');
  redirect('/workspaces');
}
