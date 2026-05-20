'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

/** Mark a single notification as read. PATCH /notifications/:id/read → 204 */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/notifications');
  return { ok: true };
}

/** Mark all notifications as read. PATCH /notifications/mark-all-read */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/notifications/mark-all-read', { method: 'PATCH' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/notifications');
  return { ok: true };
}
