import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  Permission,
  Role,
  RoleMember,
  RoleScope,
  RoleWithCounts,
  RoleWithPermissions,
  UserRoleAssignment,
} from '@projectflow/types';

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapPermission(r: any): Permission {
  return {
    id:          r.Id,
    resource:    r.Resource,
    action:      r.Action,
    slug:        r.Slug,
    scope:       r.Scope,
    description: r.Description ?? null,
    createdAt:   r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
  };
}

function mapRole(r: any): Role {
  return {
    id:          r.Id,
    name:        r.Name,
    slug:        r.Slug,
    description: r.Description ?? null,
    scope:       r.Scope,
    isSystem:    Boolean(r.IsSystem),
    workspaceId: r.WorkspaceId ?? null,
    createdAt:   r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
    updatedAt:   r.UpdatedAt instanceof Date ? r.UpdatedAt.toISOString() : String(r.UpdatedAt),
  };
}

function mapRoleWithCounts(r: any): RoleWithCounts {
  return {
    ...mapRole(r),
    permissionCount: Number(r.PermissionCount ?? 0),
    memberCount:     Number(r.MemberCount ?? 0),
  };
}

function mapAssignment(r: any): UserRoleAssignment {
  return {
    userId:        r.UserId,
    roleId:        r.RoleId,
    roleSlug:      r.RoleSlug,
    roleName:      r.RoleName,
    roleScope:     r.RoleScope,
    roleIsSystem:  Boolean(r.RoleIsSystem),
    workspaceId:   r.WorkspaceId ?? null,
    workspaceName: r.WorkspaceName ?? null,
    assignedBy:    r.AssignedBy ?? null,
    assignedAt:    r.AssignedAt instanceof Date ? r.AssignedAt.toISOString() : String(r.AssignedAt),
  };
}

function mapMember(r: any): RoleMember {
  return {
    userId:        r.UserId,
    email:         r.Email,
    name:          r.Name,
    avatarUrl:     r.AvatarUrl ?? null,
    workspaceId:   r.WorkspaceId ?? null,
    workspaceName: r.WorkspaceName ?? null,
    assignedBy:    r.AssignedBy ?? null,
    assignedAt:    r.AssignedAt instanceof Date ? r.AssignedAt.toISOString() : String(r.AssignedAt),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class RoleRepository {
  // ── Permissions ────────────────────────────────────────────────────────────

  async listPermissions(scope?: RoleScope): Promise<Permission[]> {
    const rows = await execSpOne<any>('dbo.usp_Permission_List', [
      { name: 'Scope', type: sql.NVarChar(16), value: scope ?? null },
    ]);
    return rows.map(mapPermission);
  }

  // ── Roles ──────────────────────────────────────────────────────────────────

  async listRoles(scope?: RoleScope): Promise<RoleWithCounts[]> {
    const rows = await execSpOne<any>('dbo.usp_Role_List', [
      { name: 'Scope', type: sql.NVarChar(16), value: scope ?? null },
    ]);
    return rows.map(mapRoleWithCounts);
  }

  async getRoleById(roleId: string): Promise<RoleWithPermissions | null> {
    const sets = await execSp<any>('dbo.usp_Role_GetById', [
      { name: 'RoleId', type: sql.UniqueIdentifier, value: roleId },
    ]);
    const roleRow = sets[0]?.[0];
    if (!roleRow) return null;
    return {
      ...mapRole(roleRow),
      permissions: (sets[1] ?? []).map(mapPermission),
    };
  }

  async getRoleBySlug(slug: string): Promise<Role | null> {
    const rows = await execSpOne<any>('dbo.usp_Role_GetBySlug', [
      { name: 'Slug', type: sql.NVarChar(100), value: slug },
    ]);
    return rows[0] ? mapRole(rows[0]) : null;
  }

  async createRole(input: { name: string; slug: string; description: string | null; scope: RoleScope; workspaceId?: string | null }): Promise<Role> {
    const rows = await execSpOne<any>('dbo.usp_Role_Create', [
      { name: 'Name',        type: sql.NVarChar(100),    value: input.name },
      { name: 'Slug',        type: sql.NVarChar(100),    value: input.slug },
      { name: 'Description', type: sql.NVarChar(500),    value: input.description },
      { name: 'Scope',       type: sql.NVarChar(16),     value: input.scope },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: input.workspaceId ?? null },
    ]);
    return mapRole(rows[0]);
  }

  async listRolesForWorkspace(workspaceId: string): Promise<RoleWithCounts[]> {
    const rows = await execSpOne<any>('dbo.usp_Role_ListForWorkspace', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rows.map(mapRoleWithCounts);
  }

  async updateRole(roleId: string, input: { name?: string; description?: string | null }): Promise<Role | null> {
    const rows = await execSpOne<any>('dbo.usp_Role_Update', [
      { name: 'RoleId',      type: sql.UniqueIdentifier, value: roleId },
      { name: 'Name',        type: sql.NVarChar(100),    value: input.name        ?? null },
      { name: 'Description', type: sql.NVarChar(500),    value: input.description ?? null },
    ]);
    return rows[0] ? mapRole(rows[0]) : null;
  }

  async deleteRole(roleId: string): Promise<void> {
    await execSpOne('dbo.usp_Role_Delete', [
      { name: 'RoleId', type: sql.UniqueIdentifier, value: roleId },
    ]);
  }

  async setRolePermissions(roleId: string, permissionIds: string[]): Promise<Permission[]> {
    const rows = await execSpOne<any>('dbo.usp_Role_SetPermissions', [
      { name: 'RoleId',        type: sql.UniqueIdentifier,   value: roleId },
      { name: 'PermissionIds', type: sql.NVarChar(sql.MAX),  value: JSON.stringify(permissionIds) },
    ]);
    return rows.map(mapPermission);
  }

  async listRoleMembers(roleId: string): Promise<RoleMember[]> {
    const rows = await execSpOne<any>('dbo.usp_Role_ListMembers', [
      { name: 'RoleId', type: sql.UniqueIdentifier, value: roleId },
    ]);
    return rows.map(mapMember);
  }

  // ── User-role assignments ──────────────────────────────────────────────────

  async listUserRoles(userId: string, workspaceId?: string | null): Promise<UserRoleAssignment[]> {
    const rows = await execSpOne<any>('dbo.usp_UserRole_List', [
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId ?? null },
    ]);
    return rows.map(mapAssignment);
  }

  async assignRole(input: {
    userId: string;
    roleId: string;
    workspaceId?: string | null;
    assignedBy?: string | null;
  }): Promise<UserRoleAssignment> {
    const rows = await execSpOne<any>('dbo.usp_UserRole_Assign', [
      { name: 'UserId',      type: sql.UniqueIdentifier, value: input.userId },
      { name: 'RoleId',      type: sql.UniqueIdentifier, value: input.roleId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: input.workspaceId ?? null },
      { name: 'AssignedBy',  type: sql.UniqueIdentifier, value: input.assignedBy  ?? null },
    ]);
    return mapAssignment(rows[0]);
  }

  async assignRoleBySlug(input: {
    userId: string;
    roleSlug: string;
    workspaceId?: string | null;
    assignedBy?: string | null;
  }): Promise<UserRoleAssignment> {
    const rows = await execSpOne<any>('dbo.usp_UserRole_AssignBySlug', [
      { name: 'UserId',      type: sql.UniqueIdentifier, value: input.userId },
      { name: 'RoleSlug',    type: sql.NVarChar(100),    value: input.roleSlug },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: input.workspaceId ?? null },
      { name: 'AssignedBy',  type: sql.UniqueIdentifier, value: input.assignedBy  ?? null },
    ]);
    return mapAssignment(rows[0]);
  }

  async revokeRole(userId: string, roleId: string, workspaceId?: string | null): Promise<boolean> {
    const rows = await execSpOne<any>('dbo.usp_UserRole_Revoke', [
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'RoleId',      type: sql.UniqueIdentifier, value: roleId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId ?? null },
    ]);
    return Number(rows[0]?.Deleted ?? 0) > 0;
  }

  // ── Effective permissions ──────────────────────────────────────────────────

  async getUserPermissionSlugs(userId: string, workspaceId?: string | null): Promise<Set<string>> {
    const rows = await execSpOne<{ Slug: string }>('dbo.usp_UserPermissions_Get', [
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId ?? null },
    ]);
    return new Set(rows.map((r) => r.Slug));
  }
}

export const roleRepository = new RoleRepository();
