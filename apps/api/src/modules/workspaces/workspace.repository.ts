import sql from 'mssql';
import { execSpOne, execSp } from '../../shared/lib/sqlClient.js';

export class WorkspaceRepository {
  async create(name: string, slug: string, ownerId: string) {
    const rows = await execSpOne('usp_Workspace_Create', [
      { name: 'Name',    type: sql.NVarChar(255), value: name },
      { name: 'Slug',    type: sql.NVarChar(100), value: slug },
      { name: 'OwnerId', type: sql.UniqueIdentifier, value: ownerId },
    ]);
    return rows[0];
  }

  async list(userId: string) {
    const rows = await execSpOne('usp_Workspace_List', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows;
  }

  async getById(id: string) {
    const rows = await execSpOne('usp_Workspace_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  // Lightweight status lookup used by the freeze-guard in
  // permissions.middleware. Does NOT filter on DeletedAt so an archived
  // workspace also shows up — the caller decides what to do.
  async getStatus(id: string): Promise<{ Id: string; Status: string; DeletedAt: Date | null } | null> {
    const rows = await execSpOne<{ Id: string; Status: string; DeletedAt: Date | null }>(
      'usp_Workspace_GetStatus',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }],
    );
    return rows[0] ?? null;
  }

  async addMember(workspaceId: string, userId: string, role = 'MEMBER') {
    const rows = await execSpOne('usp_WorkspaceMember_Add', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'Role',        type: sql.NVarChar(20),     value: role },
    ]);
    return rows[0];
  }

  async update(id: string, fields: { name?: string; slug?: string; avatarUrl?: string | null }) {
    const rows = await execSpOne('usp_Workspace_Update', [
      { name: 'Id',        type: sql.UniqueIdentifier,  value: id },
      { name: 'Name',      type: sql.NVarChar(255),     value: fields.name ?? null },
      { name: 'Slug',      type: sql.NVarChar(100),     value: fields.slug ?? null },
      { name: 'AvatarUrl', type: sql.NVarChar(500),     value: fields.avatarUrl ?? null },
    ]);
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await execSpOne('usp_Workspace_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async listMembers(workspaceId: string) {
    const rows = await execSpOne<{
      Id: string;
      Email: string;
      Name: string;
      AvatarUrl: string | null;
      JoinedAt: string;
      RoleSlugs: string | null;
      IsOwner: boolean;
    }>('usp_Workspace_ListMembers', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rows;
  }

  async addMemberByEmail(workspaceId: string, email: string, role = 'MEMBER') {
    const rows = await execSpOne('usp_WorkspaceMember_AddByEmail', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'Email',       type: sql.NVarChar(255),    value: email },
      { name: 'Role',        type: sql.NVarChar(20),     value: role },
    ]);
    return rows[0] ?? null;
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await execSpOne('usp_WorkspaceMember_Remove', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
    ]);
  }

  async setMemberRole(workspaceId: string, userId: string, role: string) {
    const rows = await execSpOne<{ UserId: string; RoleSlug: string }>(
      'usp_WorkspaceMember_SetRole',
      [
        { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
        { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
        { name: 'Role',        type: sql.NVarChar(20),     value: role },
      ],
    );
    return rows[0] ?? null;
  }
}
