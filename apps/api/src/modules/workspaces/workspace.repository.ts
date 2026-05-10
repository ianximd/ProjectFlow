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
}
