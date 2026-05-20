'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { COOKIE, COOKIE_BASE, SELECTION_MAX_AGE } from '../cookies';
import type { Selection } from '../selection';

export async function setSelection(input: Partial<Selection>): Promise<void> {
  const jar = await cookies();
  let current: Partial<Selection> = {};
  try { current = JSON.parse(jar.get(COOKIE.selection)?.value ?? '{}'); } catch { /* ignore */ }

  const next: Selection = {
    workspaceId: input.workspaceId !== undefined ? input.workspaceId : current.workspaceId ?? null,
    projectId:   input.projectId   !== undefined ? input.projectId   : current.projectId   ?? null,
  };

  jar.set(COOKIE.selection, JSON.stringify(next), { ...COOKIE_BASE, maxAge: SELECTION_MAX_AGE });
  revalidatePath('/', 'layout');
}
