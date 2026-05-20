'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import type { ProjectType } from '../queries/normalize';

export type ActionResult = { ok: true } | { ok: false; error: string };

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
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function archiveProject(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Archive failed' };
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
  revalidatePath('/projects');
  return { ok: true };
}
