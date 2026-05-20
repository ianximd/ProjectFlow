'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export type { ActionResult };

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
