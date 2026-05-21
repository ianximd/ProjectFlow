'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { getWorkspaceMembers, type MemberRow } from '../queries/workspace';
import type { ActionResult } from './result';


/** POST /workspaces/{id}/members/by-email — invite an existing user by email. */
export async function inviteMember(
  wsId: string,
  email: string,
  role: 'ADMIN' | 'MEMBER' | 'VIEWER',
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workspaces/${encodeURIComponent(wsId)}/members/by-email`, {
      method: 'POST',
      body:   JSON.stringify({ email, role }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${wsId}/members`);
  return { ok: true };
}

/** DELETE /workspaces/{id}/members/{userId} — remove a member from the workspace. */
export async function removeMember(wsId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${wsId}/members`);
  return { ok: true };
}

/** PUT /workspaces/{id}/members/{userId}/role — change a member's role. */
export async function updateMemberRole(
  wsId: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER' | 'VIEWER',
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(
      `/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}/role`,
      {
        method: 'PUT',
        body:   JSON.stringify({ role }),
      },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${wsId}/members`);
  return { ok: true };
}

/** Server-action wrapper exposing the workspace member list to client
 *  components (the TaskDrawer assignee picker). */
export async function loadWorkspaceMembers(workspaceId: string): Promise<MemberRow[]> {
  await requireSession();
  return getWorkspaceMembers(workspaceId);
}
