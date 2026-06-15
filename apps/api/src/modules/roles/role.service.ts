import type { RoleScope } from '@projectflow/types';
import { roleRepository } from './role.repository.js';
import { writeAccessAudit } from '../access/access.audit.js';

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

  // ── Workspace custom roles (Phase 10b) ──
  listWorkspaceRoles: (workspaceId: string) => roleRepository.listRolesForWorkspace(workspaceId),

  async createWorkspaceRole(input: { workspaceId: string; name: string; description?: string | null; permissionIds: string[]; actorId: string; actorEmail?: string | null; }) {
    const slug = slugify(input.name);
    const role = await roleRepository.createRole({ name: input.name.trim(), slug, description: input.description ?? null, scope: 'WORKSPACE', workspaceId: input.workspaceId });
    const permissions = input.permissionIds.length ? await roleRepository.setRolePermissions(role.id, input.permissionIds) : [];
    await writeAccessAudit({ workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null, action: 'role.create', resource: 'Role', resourceId: role.id, newValues: { name: role.name, slug: role.slug, permissionIds: input.permissionIds } });
    return { ...role, permissions };
  },

  /** Guard: role must exist, be a custom role, and belong to this workspace. */
  async assertWorkspaceCustomRole(workspaceId: string, roleId: string) {
    const role = await roleRepository.getRoleById(roleId);
    if (!role || role.workspaceId !== workspaceId) return { ok: false as const, code: 'NOT_FOUND' as const };
    if (role.isSystem) return { ok: false as const, code: 'IMMUTABLE' as const };
    return { ok: true as const, role };
  },

  async updateWorkspaceRole(input: { workspaceId: string; roleId: string; name?: string; description?: string | null; permissionIds?: string[]; actorId: string; actorEmail?: string | null; }) {
    const guard = await roleService.assertWorkspaceCustomRole(input.workspaceId, input.roleId);
    if (!guard.ok) return guard;
    const updated = await roleRepository.updateRole(input.roleId, { name: input.name, description: input.description });
    if (input.permissionIds) await roleRepository.setRolePermissions(input.roleId, input.permissionIds);
    await writeAccessAudit({ workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null, action: 'role.update', resource: 'Role', resourceId: input.roleId, oldValues: { name: guard.role.name }, newValues: { name: input.name, permissionIds: input.permissionIds } });
    return { ok: true as const, role: updated };
  },

  async deleteWorkspaceRole(input: { workspaceId: string; roleId: string; actorId: string; actorEmail?: string | null; }) {
    const guard = await roleService.assertWorkspaceCustomRole(input.workspaceId, input.roleId);
    if (!guard.ok) return guard;
    await roleRepository.deleteRole(input.roleId);
    await writeAccessAudit({ workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null, action: 'role.delete', resource: 'Role', resourceId: input.roleId, oldValues: { name: guard.role.name, slug: guard.role.slug } });
    return { ok: true as const };
  },

  async assignWorkspaceRole(input: { workspaceId: string; userId: string; roleId: string; actorId: string; actorEmail?: string | null; }) {
    const role = await roleRepository.getRoleById(input.roleId);
    if (!role || role.scope !== 'WORKSPACE' || (role.workspaceId !== null && role.workspaceId !== input.workspaceId)) return { ok: false as const, code: 'NOT_FOUND' as const };
    const assignment = await roleRepository.assignRole({ userId: input.userId, roleId: input.roleId, workspaceId: input.workspaceId, assignedBy: input.actorId });
    await writeAccessAudit({ workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null, action: 'role.assign', resource: 'UserRole', resourceId: input.userId, newValues: { roleId: input.roleId, targetUserId: input.userId } });
    return { ok: true as const, assignment };
  },

  async revokeWorkspaceRole(input: { workspaceId: string; userId: string; roleId: string; actorId: string; actorEmail?: string | null; }) {
    const removed = await roleRepository.revokeRole(input.userId, input.roleId, input.workspaceId);
    if (removed) {
      await writeAccessAudit({ workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null, action: 'role.revoke', resource: 'UserRole', resourceId: input.userId, oldValues: { roleId: input.roleId, targetUserId: input.userId } });
    }
    return { ok: removed as boolean };
  },
};
