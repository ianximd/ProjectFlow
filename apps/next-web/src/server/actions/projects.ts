'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ProjectType } from '../queries/normalize';

import type { ActionResult } from './result';
export type { ActionResult };

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  key: string;
  type: ProjectType;
  description: string;
}

export async function createProject(input: CreateProjectInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        name: input.name,
        key: input.key,
        type: input.type,
        description: input.description || null,
      }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function archiveProject(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/projects');
  return { ok: true };
}
