'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetchBody } from '../api';
import { toActionError } from './error';
import type { GuestListResult, HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import type { ActionResult } from './result';

/** GET /guests?workspaceId=… — returns { guests, pending } (no {data} envelope). */
export async function loadGuests(workspaceId: string): Promise<GuestListResult> {
  await requireSession();
  const body = await serverFetchBody<GuestListResult>(
    `/guests?workspaceId=${encodeURIComponent(workspaceId)}`,
  ).catch(() => null);
  return body ?? { guests: [], pending: [] };
}

/** POST /guests/invites — invite a guest to a specific object. */
export async function inviteGuest(input: {
  workspaceId: string;
  email: string;
  objectType: HierarchyNodeType;
  objectId: string;
  level: ObjectPermissionLevel;
}): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetchBody('/guests/invites', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${input.workspaceId}/members`);
  return { ok: true };
}

/** POST /guests/invites/:token/accept — accept a guest invite by token.
 *  Returns the granted objectType + objectId so the accept page can redirect. */
export async function acceptGuestInvite(
  token: string,
): Promise<ActionResult<{ objectType: HierarchyNodeType; objectId: string }>> {
  await requireSession();
  try {
    const body = await serverFetchBody<{
      accepted: { objectType: HierarchyNodeType; objectId: string };
    }>(`/guests/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: '{}',
    });
    return { ok: true, data: { objectType: body.accepted.objectType, objectId: body.accepted.objectId } };
  } catch (e) {
    return toActionError(e);
  }
}

/** DELETE /guests/:userId?workspaceId=… — revoke a guest's access. */
export async function revokeGuest(workspaceId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetchBody(
      `/guests/${encodeURIComponent(userId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/workspaces/${workspaceId}/members`);
  return { ok: true };
}
