'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch, serverFetchEnvelope } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

const ADMIN = '/admin';

// ── User mutations ────────────────────────────────────────────────────────────

export async function createUser(input: {
  email: string;
  name: string;
  password?: string;
  isEmailVerified: boolean;
}): Promise<ActionResult<{ tempPassword: string | null }>> {
  await requireSession();
  try {
    // POST /admin/users returns { data: user, meta: { tempPassword } }
    // serverFetchEnvelope gives us access to meta.
    const { meta } = await serverFetchEnvelope<unknown, { tempPassword?: string | null }>(
      '/admin/users',
      { method: 'POST', body: JSON.stringify(input) },
    );
    revalidatePath(ADMIN);
    return { ok: true, data: { tempPassword: meta?.tempPassword ?? null } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateUser(
  id: string,
  fields: { email?: string; name?: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteUser(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/users/${id}`, { method: 'DELETE' });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function suspendUser(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/users/${id}/suspend`, { method: 'POST' });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function restoreUser(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/users/${id}/restore`, { method: 'POST' });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetPassword(
  id: string,
): Promise<ActionResult<{ tempPassword: string }>> {
  await requireSession();
  try {
    // POST /admin/users/:id/reset-password returns { data: { tempPassword } }
    const result = await serverFetch<{ tempPassword: string }>(
      `/admin/users/${id}/reset-password`,
      { method: 'POST' },
    );
    revalidatePath(ADMIN);
    return { ok: true, data: { tempPassword: result.tempPassword } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function disableMfa(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/users/${id}/disable-mfa`, { method: 'POST' });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function unlockUser(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/users/${id}/unlock`, { method: 'POST' });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function bulkSuspend(
  userIds: string[],
  suspend: boolean,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/admin/users/bulk-suspend', {
      method: 'POST',
      body: JSON.stringify({ userIds, suspend }),
    });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Workspace mutations ───────────────────────────────────────────────────────

export async function setWorkspaceStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/workspaces/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    revalidatePath(ADMIN);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
