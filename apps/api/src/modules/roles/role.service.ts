import type { RoleScope } from '@projectflow/types';
import { roleRepository } from './role.repository.js';

// ─── Slug helpers ────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const roleService = {
  // ── Catalog ──────────────────────────────────────────────────────────────
  listPermissions: (scope?: RoleScope) => roleRepository.listPermissions(scope),
  listRoles:       (scope?: RoleScope) => roleRepository.listRoles(scope),
  getRoleById:     (id: string)        => roleRepository.getRoleById(id),
  getRoleBySlug:   (slug: string)      => roleRepository.getRoleBySlug(slug),
  listRoleMembers: (id: string)        => roleRepository.listRoleMembers(id),

  // ── Mutations ────────────────────────────────────────────────────────────
  async createRole(input: {
    name: string;
    description?: string | null;
    scope: RoleScope;
    permissionIds?: string[];
  }) {
    const slug = slugify(input.name);
    const role = await roleRepository.createRole({
      name:        input.name.trim(),
      slug,
      description: input.description ?? null,
      scope:       input.scope,
    });
    if (input.permissionIds?.length) {
      const perms = await roleRepository.setRolePermissions(role.id, input.permissionIds);
      return { ...role, permissions: perms };
    }
    return { ...role, permissions: [] };
  },

  updateRole: (
    id: string,
    input: { name?: string; description?: string | null },
  ) => roleRepository.updateRole(id, input),

  deleteRole: (id: string) => roleRepository.deleteRole(id),

  setRolePermissions: (id: string, permissionIds: string[]) =>
    roleRepository.setRolePermissions(id, permissionIds),

  // ── Assignments ──────────────────────────────────────────────────────────
  listUserRoles: (userId: string, workspaceId?: string | null) =>
    roleRepository.listUserRoles(userId, workspaceId),

  assignRole: (input: {
    userId: string;
    roleId: string;
    workspaceId?: string | null;
    assignedBy?: string | null;
  }) => roleRepository.assignRole(input),

  assignRoleBySlug: (input: {
    userId: string;
    roleSlug: string;
    workspaceId?: string | null;
    assignedBy?: string | null;
  }) => roleRepository.assignRoleBySlug(input),

  revokeRole: (userId: string, roleId: string, workspaceId?: string | null) =>
    roleRepository.revokeRole(userId, roleId, workspaceId),

  // ── Effective permissions (used by middleware) ───────────────────────────
  getUserPermissionSlugs: (userId: string, workspaceId?: string | null) =>
    roleRepository.getUserPermissionSlugs(userId, workspaceId),
};
