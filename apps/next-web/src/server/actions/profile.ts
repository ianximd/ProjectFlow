'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export async function updateMyName(name: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/auth/me', { method: 'PATCH', body: JSON.stringify({ name }) });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/settings/profile');
  return { ok: true };
}

export async function uploadMyAvatar(formData: FormData): Promise<ActionResult> {
  await requireSession();
  try {
    // FormData body → serverFetch omits JSON Content-Type so fetch sets the multipart boundary (Foundation F2).
    await serverFetch('/avatars/me', { method: 'POST', body: formData });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/settings/profile');
  return { ok: true };
}

export async function removeMyAvatar(): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/avatars/me', { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/settings/profile');
  return { ok: true };
}
