'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import type { ActionResult } from './result';
export type { ActionResult };

/** Mark a single notification as read. PATCH /notifications/:id/read → 204 */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Mark-read failed' };
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
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Mark-all-read failed' };
  }
  revalidatePath('/notifications');
  return { ok: true };
}
