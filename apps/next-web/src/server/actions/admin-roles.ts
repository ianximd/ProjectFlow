'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import {
  getRoles,
  getRoleDetail,
  getPermissions,
  getRoleMembers,
  getUserRoleAssignments,
  searchUsersForRoles,
  getAllWorkspacesForRoles,
} from '../queries/admin-roles';
import type {
  AdminUser,
  AdminWorkspace,
  Permission,
  RoleMember,
  RoleScope,
  RoleWithCounts,
  RoleWithPermissions,
  UserRoleAssignment,
} from '@projectflow/types';
import type { ActionResult } from './result';

export interface CreateRoleInput {
  name:          string;
  description:   string | null;
  scope:         RoleScope;
  permissionIds: string[];
}

/** POST /admin/roles */
export async function createRole(input: CreateRoleInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/admin/roles', { method: 'POST', body: JSON.stringify(input) });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/admin');
  return { ok: true };
}

/** PATCH /admin/roles/:id { name, description } */
export async function updateRole(
  id: string,
  input: { name: string; description: string | null },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/roles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/admin');
  return { ok: true };
}

/** PUT /admin/roles/:id/permissions { permissionIds } */
export async function setRolePermissions(id: string, permissionIds: string[]): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/roles/${encodeURIComponent(id)}/permissions`, {
      method: 'PUT',
      body:   JSON.stringify({ permissionIds }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/admin');
  return { ok: true };
}

/** DELETE /admin/roles/:id */
export async function deleteRole(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/admin');
  return { ok: true };
}

/** POST /admin/user-roles/:userId { roleId, workspaceId } */
export async function assignUserRole(
  userId: string,
  input: { roleId: string; workspaceId: string | null },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/admin/user-roles/${encodeURIComponent(userId)}`, {
      method: 'POST',
      body:   JSON.stringify(input),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/admin');
  return { ok: true };
}

/** DELETE /admin/user-roles/:userId/:roleId?workspaceId= */
export async function revokeUserRole(
  userId: string,
  roleId: string,
  workspaceId: string | null,
): Promise<ActionResult> {
  await requireSession();
  const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  try {
    await serverFetch(
      `/admin/user-roles/${encodeURIComponent(userId)}/${encodeURIComponent(roleId)}${q}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/admin');
  return { ok: true };
}

// ── Refetch wrappers for the converted client components ────────────────────────

export async function loadRoles(scope?: RoleScope): Promise<RoleWithCounts[]> {
  await requireSession();
  return getRoles(scope);
}

export async function loadRoleDetail(id: string): Promise<RoleWithPermissions> {
  await requireSession();
  return getRoleDetail(id);
}

export async function loadPermissions(): Promise<Permission[]> {
  await requireSession();
  return getPermissions();
}

export async function loadRoleMembers(roleId: string): Promise<RoleMember[]> {
  await requireSession();
  return getRoleMembers(roleId);
}

export async function loadUserRoleAssignments(userId: string): Promise<UserRoleAssignment[]> {
  await requireSession();
  return getUserRoleAssignments(userId);
}

export async function loadUsersForRoles(search: string): Promise<AdminUser[]> {
  await requireSession();
  return searchUsersForRoles(search);
}

export async function loadAllWorkspacesForRoles(): Promise<AdminWorkspace[]> {
  await requireSession();
  return getAllWorkspacesForRoles();
}
