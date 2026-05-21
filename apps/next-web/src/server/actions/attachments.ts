'use server';

import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { getAttachments, type Attachment } from '../queries/attachments';
import type { ActionResult } from './result';

/** POST /attachments (multipart) — form carries `taskId` + `file`.
 *  serverFetch omits the JSON Content-Type for FormData bodies so fetch sets
 *  the multipart boundary itself. */
export async function uploadAttachment(form: FormData): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/attachments', { method: 'POST', body: form });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}

/** DELETE /attachments/:id */
export async function deleteAttachment(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}

/** GET /attachments/:id/download → { data: { url } } (a signed, time-limited URL). */
export async function getAttachmentDownloadUrl(id: string): Promise<ActionResult<{ url: string }>> {
  await requireSession();
  try {
    const data = await serverFetch<{ url?: string }>(`/attachments/${encodeURIComponent(id)}/download`);
    return { ok: true, data: { url: data?.url ?? '' } };
  } catch (e) {
    return toActionError(e);
  }
}

/** Server-action refetch wrapper for the converted client component. */
export async function loadAttachments(taskId: string): Promise<Attachment[]> {
  await requireSession();
  return getAttachments(taskId);
}
