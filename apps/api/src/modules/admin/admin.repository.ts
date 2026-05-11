import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { AuditLogEntry, AdminStats, AdminUser, AdminWorkspace } from '@projectflow/types';

// ─── Audit log ────────────────────────────────────────────────────────────────

export interface CreateAuditInput {
  workspaceId?: string | null;
  userId:       string;
  userEmail?:   string | null;
  action:       string;   // CREATE | UPDATE | DELETE | LOGIN | LOGOUT | etc.
  resource:     string;   // Task | Project | Sprint | User | Webhook | ...
  resourceId?:  string | null;
  oldValues?:   Record<string, unknown> | null;
  newValues?:   Record<string, unknown> | null;
  ipAddress?:   string | null;
  userAgent?:   string | null;
}

export interface AuditListFilters {
  workspaceId?: string;
  userId?:      string;
  resource?:    string;
  action?:      string;
  resourceId?:  string;
  fromDate?:    Date;
  toDate?:      Date;
  page?:        number;
  pageSize?:    number;
}

function mapEntry(r: any): AuditLogEntry {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId ?? null,
    userId:      r.UserId,
    userEmail:   r.UserEmail ?? null,
    action:      r.Action,
    resource:    r.Resource,
    resourceId:  r.ResourceId ?? null,
    oldValues:   r.OldValues ? JSON.parse(r.OldValues) : null,
    newValues:   r.NewValues ? JSON.parse(r.NewValues) : null,
    ipAddress:   r.IpAddress ?? null,
    userAgent:   r.UserAgent ?? null,
    createdAt:   r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
  };
}

export class AdminRepository {
  async createAuditEntry(input: CreateAuditInput): Promise<void> {
    await execSpOne('dbo.usp_AuditLog_Create', [
      { name: 'WorkspaceId', type: sql.NVarChar(255), value: input.workspaceId ?? null },
      { name: 'UserId',      type: sql.NVarChar(255), value: input.userId },
      { name: 'UserEmail',   type: sql.NVarChar(320), value: input.userEmail ?? null },
      { name: 'Action',      type: sql.NVarChar(50),  value: input.action },
      { name: 'Resource',    type: sql.NVarChar(100), value: input.resource },
      { name: 'ResourceId',  type: sql.NVarChar(255), value: input.resourceId ?? null },
      { name: 'OldValues',   type: sql.NVarChar(sql.MAX), value: input.oldValues ? JSON.stringify(input.oldValues) : null },
      { name: 'NewValues',   type: sql.NVarChar(sql.MAX), value: input.newValues ? JSON.stringify(input.newValues) : null },
      { name: 'IpAddress',   type: sql.NVarChar(50),  value: input.ipAddress ?? null },
      { name: 'UserAgent',   type: sql.NVarChar(512), value: input.userAgent ?? null },
    ]);
  }

  async listAuditLog(filters: AuditListFilters): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const page     = filters.page     ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const rows = await execSpOne<any>('dbo.usp_AuditLog_List', [
      { name: 'WorkspaceId', type: sql.NVarChar(255), value: filters.workspaceId ?? null },
      { name: 'UserId',      type: sql.NVarChar(255), value: filters.userId      ?? null },
      { name: 'Resource',    type: sql.NVarChar(100), value: filters.resource    ?? null },
      { name: 'Action',      type: sql.NVarChar(50),  value: filters.action      ?? null },
      { name: 'ResourceId',  type: sql.NVarChar(255), value: filters.resourceId  ?? null },
      { name: 'FromDate',    type: sql.DateTime2,     value: filters.fromDate    ?? null },
      { name: 'ToDate',      type: sql.DateTime2,     value: filters.toDate      ?? null },
      { name: 'Page',        type: sql.Int,           value: page },
      { name: 'PageSize',    type: sql.Int,           value: pageSize },
    ]);
    const total   = rows[0]?.TotalCount ?? 0;
    const entries = rows.map(mapEntry);
    return { entries, total };
  }

  // ─── Admin queries ──────────────────────────────────────────────────────────

  async getStats(): Promise<AdminStats> {
    const rows = await execSpOne<any>('dbo.usp_Admin_GetStats');
    const r    = rows[0];
    return {
      totalUsers:        r?.TotalUsers        ?? 0,
      totalWorkspaces:   r?.TotalWorkspaces   ?? 0,
      totalProjects:     r?.TotalProjects     ?? 0,
      totalTasks:        r?.TotalTasks        ?? 0,
      tasksCreatedToday: r?.TasksCreatedToday ?? 0,
      loginsLast24h:     r?.LoginsLast24h     ?? 0,
      auditEventsToday:  r?.AuditEventsToday  ?? 0,
    };
  }

  async listUsers(search?: string, page = 1, pageSize = 50): Promise<{ users: AdminUser[]; total: number }> {
    const rows = await execSpOne<any>('dbo.usp_Admin_ListUsers', [
      { name: 'Search',   type: sql.NVarChar(255), value: search ?? null },
      { name: 'Page',     type: sql.Int,           value: page },
      { name: 'PageSize', type: sql.Int,           value: pageSize },
    ]);
    const total = rows[0]?.TotalCount ?? 0;
    const users: AdminUser[] = rows.map((r: any) => ({
      id:              r.Id,
      email:           r.Email,
      name:            r.Name,
      avatarUrl:       r.AvatarUrl ?? null,
      isEmailVerified: Boolean(r.IsEmailVerified),
      mfaEnabled:      Boolean(r.MfaEnabled),
      workspaceCount:  r.WorkspaceCount ?? 0,
      createdAt:       r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
      deletedAt:       r.DeletedAt ? (r.DeletedAt instanceof Date ? r.DeletedAt.toISOString() : String(r.DeletedAt)) : null,
    }));
    return { users, total };
  }

  async listWorkspaces(page = 1, pageSize = 50): Promise<{ workspaces: AdminWorkspace[]; total: number }> {
    const rows = await execSpOne<any>('dbo.usp_Admin_ListWorkspaces', [
      { name: 'Page',     type: sql.Int, value: page },
      { name: 'PageSize', type: sql.Int, value: pageSize },
    ]);
    const total = rows[0]?.TotalCount ?? 0;
    const workspaces: AdminWorkspace[] = rows.map((r: any) => ({
      id:           r.Id,
      name:         r.Name,
      slug:         r.Slug,
      avatarUrl:    r.AvatarUrl   ?? null,
      ownerEmail:   r.OwnerEmail  ?? null,
      memberCount:  r.MemberCount ?? 0,
      projectCount: r.ProjectCount ?? 0,
      createdAt:    r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
      deletedAt:    r.DeletedAt ? (r.DeletedAt instanceof Date ? r.DeletedAt.toISOString() : String(r.DeletedAt)) : null,
    }));
    return { workspaces, total };
  }

  // ─── Admin user CRUD + recovery ─────────────────────────────────────────────

  async createUser(email: string, name: string, passwordHash: string, isEmailVerified = true): Promise<AdminUser> {
    const rows = await execSpOne<any>('dbo.usp_Admin_User_Create', [
      { name: 'Email',           type: sql.NVarChar(255), value: email },
      { name: 'Name',            type: sql.NVarChar(255), value: name },
      { name: 'PasswordHash',    type: sql.NVarChar(255), value: passwordHash },
      { name: 'IsEmailVerified', type: sql.Bit,           value: isEmailVerified ? 1 : 0 },
    ]);
    const r = rows[0]!;
    return {
      id:              r.Id,
      email:           r.Email,
      name:            r.Name,
      avatarUrl:       r.AvatarUrl ?? null,
      isEmailVerified: Boolean(r.IsEmailVerified),
      mfaEnabled:      Boolean(r.MfaEnabled),
      workspaceCount:  r.WorkspaceCount ?? 0,
      createdAt:       r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
      deletedAt:       r.DeletedAt ? (r.DeletedAt instanceof Date ? r.DeletedAt.toISOString() : String(r.DeletedAt)) : null,
    };
  }

  async updateUser(id: string, fields: { email?: string; name?: string }): Promise<AdminUser | null> {
    const rows = await execSpOne<any>('dbo.usp_Admin_User_Update', [
      { name: 'Id',    type: sql.UniqueIdentifier, value: id },
      { name: 'Email', type: sql.NVarChar(255),    value: fields.email ?? null },
      { name: 'Name',  type: sql.NVarChar(255),    value: fields.name  ?? null },
    ]);
    const r = rows[0];
    if (!r) return null;
    return {
      id:              r.Id,
      email:           r.Email,
      name:            r.Name,
      avatarUrl:       r.AvatarUrl ?? null,
      isEmailVerified: Boolean(r.IsEmailVerified),
      mfaEnabled:      Boolean(r.MfaEnabled),
      workspaceCount:  r.WorkspaceCount ?? 0,
      createdAt:       r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
      deletedAt:       r.DeletedAt ? (r.DeletedAt instanceof Date ? r.DeletedAt.toISOString() : String(r.DeletedAt)) : null,
    };
  }

  async hardDeleteUser(id: string): Promise<void> {
    await execSpOne('dbo.usp_Admin_User_HardDelete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await execSpOne('dbo.usp_Admin_User_SetPassword', [
      { name: 'Id',           type: sql.UniqueIdentifier, value: id },
      { name: 'PasswordHash', type: sql.NVarChar(255),    value: passwordHash },
    ]);
  }

  async disableMfa(id: string): Promise<void> {
    await execSpOne('dbo.usp_Admin_User_DisableMfa', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async unlockUser(id: string): Promise<void> {
    await execSpOne('dbo.usp_Admin_User_Unlock', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async toggleUserActive(userId: string, suspend: boolean): Promise<AdminUser | null> {
    const rows = await execSpOne<any>('dbo.usp_Admin_ToggleUserActive', [
      { name: 'UserId',  type: sql.NVarChar(255), value: userId },
      { name: 'Suspend', type: sql.Bit,            value: suspend ? 1 : 0 },
    ]);
    const r = rows[0];
    if (!r) return null;
    return {
      id:              r.Id,
      email:           r.Email,
      name:            r.Name,
      avatarUrl:       null,
      isEmailVerified: Boolean(r.IsEmailVerified),
      mfaEnabled:      false,
      workspaceCount:  0,
      createdAt:       r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
      deletedAt:       r.DeletedAt ? (r.DeletedAt instanceof Date ? r.DeletedAt.toISOString() : String(r.DeletedAt)) : null,
    };
  }
}

// Singleton
export const adminRepository = new AdminRepository();
