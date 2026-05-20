'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';


export interface CreateVersionInput {
  projectId: string;
  name: string;
  description?: string;
  startDate?: string;
  releaseDate?: string;
}

export async function createVersion(input: CreateVersionInput): Promise<ActionResult> {
  await requireSession();
  try {
    const body: Record<string, unknown> = {
      projectId: input.projectId,
      name:      input.name,
    };
    if (input.description) body.description = input.description;
    if (input.startDate)   body.startDate   = input.startDate;
    if (input.releaseDate) body.releaseDate  = input.releaseDate;
    await serverFetch('/versions', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/versions');
  return { ok: true };
}

export async function updateVersion(
  id: string,
  changed: Partial<{ name: string; description: string; startDate: string; releaseDate: string }>,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/versions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(changed),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/versions');
  return { ok: true };
}

export async function releaseVersion(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/versions/${encodeURIComponent(id)}/release`, { method: 'POST' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/versions');
  return { ok: true };
}

export async function archiveVersion(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/versions/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/versions');
  return { ok: true };
}

export async function deleteVersion(id: string, projectId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(
      `/versions/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/versions');
  return { ok: true };
}
