'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export async function createFolder(input: { workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position?: number }): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/folders', { method: 'POST', body: JSON.stringify({ position: 0, ...input }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function createList(input: { workspaceId: string; spaceId: string; folderId: string | null; name: string; position?: number }): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/lists', { method: 'POST', body: JSON.stringify({ position: 0, ...input }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function moveFolder(id: string, parentFolderId: string | null, position: number, spaceId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/folders/${encodeURIComponent(id)}/move`, { method: 'PATCH', body: JSON.stringify({ parentFolderId, position, spaceId }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function moveList(id: string, folderId: string | null, position: number, spaceId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/lists/${encodeURIComponent(id)}/move`, { method: 'PATCH', body: JSON.stringify({ folderId, position, spaceId }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function moveTaskToList(taskId: string, listId: string, position: number): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/tasks/${encodeURIComponent(taskId)}/move`, { method: 'PATCH', body: JSON.stringify({ listId, position }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
/** Create a task directly into a List (the API derives the Space via listId). */
export async function createTaskInList(listId: string, workspaceId: string, title: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/tasks', { method: 'POST', body: JSON.stringify({ title, listId, workspaceId }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/lists/${listId}`); return { ok: true };
}
export async function renameFolder(id: string, name: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function renameList(id: string, name: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function deleteFolder(id: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
export async function deleteList(id: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
