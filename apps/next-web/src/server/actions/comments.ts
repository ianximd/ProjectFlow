'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { getComments, type Comment } from '../queries/comments';
import type { ActionResult } from './result';

/** POST /comments { taskId, body } */
export async function addComment(taskId: string, body: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/comments', { method: 'POST', body: JSON.stringify({ taskId, body }) });
  } catch (e) {
    return toActionError(e);
  }
  // Comment count can surface on the board/backlog cards.
  revalidatePath('/board');
  revalidatePath('/backlog');
  return { ok: true };
}

/** PATCH /comments/:id { body } */
export async function editComment(id: string, body: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify({ body }),
    });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}

/** DELETE /comments/:id */
export async function deleteComment(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/board');
  revalidatePath('/backlog');
  return { ok: true };
}

/** POST /comments/:id/reactions { emoji } */
export async function reactToComment(commentId: string, emoji: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/comments/${encodeURIComponent(commentId)}/reactions`, {
      method: 'POST',
      body:   JSON.stringify({ emoji }),
    });
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}

/** Server-action refetch wrapper — a client component cannot import the
 *  `server-only` query module directly, so it calls this instead. */
export async function loadComments(taskId: string): Promise<Comment[]> {
  await requireSession();
  return getComments(taskId);
}
