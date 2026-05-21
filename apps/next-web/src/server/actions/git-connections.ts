'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { getGitConnections } from '../queries/git-connections';
import type { GitConnection, GitProvider } from '@projectflow/types';
import type { ActionResult } from './result';

export interface CreateGitConnectionInput {
  provider:      GitProvider;
  repoOwner:     string;
  repoName:      string;
  webhookSecret: string;
}

/** POST /git/connections */
export async function createGitConnection(
  workspaceId: string,
  input: CreateGitConnectionInput,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/git/connections', {
      method: 'POST',
      body:   JSON.stringify({ ...input, workspaceId }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** DELETE /git/connections/:id */
export async function deleteGitConnection(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/git/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/project-settings');
  return { ok: true };
}

/** Refetch wrapper for the converted client component. */
export async function loadGitConnections(workspaceId: string): Promise<GitConnection[]> {
  await requireSession();
  return getGitConnections(workspaceId);
}
