'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { Permission, RoleWithCounts } from '@projectflow/types';
import type { ActionResult } from './result';

export async function loadWorkspaceRoles(workspaceId: string): Promise<RoleWithCounts[]> {
  await requireSession();
  return (await serverFetch<RoleWithCounts[]>(`/admin/workspaces/${workspaceId}/roles`)) ?? [];
}

export async function loadWorkspacePermissions(workspaceId: string): Promise<Permission[]> {
  await requireSession();
  return (await serverFetch<Permission[]>(`/admin/workspaces/${workspaceId}/permissions`)) ?? [];
}

export async function createWorkspaceRole(
  workspaceId: string, input: { name: string; description: string | null; permissionIds: string[] },
): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles`, { method: 'POST', body: JSON.stringify(input) }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function updateWorkspaceRole(
  workspaceId: string, roleId: string,
  input: { name?: string; description?: string | null; permissionIds?: string[] },
): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function deleteWorkspaceRole(workspaceId: string, roleId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function assignWorkspaceRole(workspaceId: string, roleId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}

export async function revokeWorkspaceRole(workspaceId: string, roleId: string, userId: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/admin/workspaces/${workspaceId}/roles/${roleId}/members/${userId}`, { method: 'DELETE' }); }
  catch (e) { return toActionError(e); }
  revalidatePath(`/workspaces/${workspaceId}/settings`);
  return { ok: true };
}
