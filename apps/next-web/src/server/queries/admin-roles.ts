import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
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

// All /admin/roles* + /admin/user-roles* endpoints return the standard { data }
// envelope (the pre-migration client read `.then(j => j.data)`).

export const getRoles = cache(async (scope?: RoleScope): Promise<RoleWithCounts[]> => {
  const q = scope ? `?scope=${scope}` : '';
  return (await serverFetch<RoleWithCounts[]>(`/admin/roles${q}`)) ?? [];
});

export const getRoleDetail = cache(async (id: string): Promise<RoleWithPermissions> => {
  return serverFetch<RoleWithPermissions>(`/admin/roles/${encodeURIComponent(id)}`);
});

export const getPermissions = cache(async (): Promise<Permission[]> => {
  return (await serverFetch<Permission[]>('/admin/permissions')) ?? [];
});

export const getRoleMembers = cache(async (roleId: string): Promise<RoleMember[]> => {
  return (await serverFetch<RoleMember[]>(`/admin/roles/${encodeURIComponent(roleId)}/members`)) ?? [];
});

export const getUserRoleAssignments = cache(async (userId: string): Promise<UserRoleAssignment[]> => {
  return (await serverFetch<UserRoleAssignment[]>(`/admin/user-roles/${encodeURIComponent(userId)}`)) ?? [];
});

// Picker queries: the role editor needs the full workspace list (pageSize 200)
// and a name/email search over users (pageSize 20) — distinct from the paginated
// admin tables in queries/admin.ts.
export const searchUsersForRoles = cache(async (search: string): Promise<AdminUser[]> => {
  return (await serverFetch<AdminUser[]>(
    `/admin/users?search=${encodeURIComponent(search)}&page=1&pageSize=20`,
  )) ?? [];
});

export const getAllWorkspacesForRoles = cache(async (): Promise<AdminWorkspace[]> => {
  return (await serverFetch<AdminWorkspace[]>('/admin/workspaces?page=1&pageSize=200')) ?? [];
});
