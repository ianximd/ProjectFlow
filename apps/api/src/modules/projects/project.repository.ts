import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export class ProjectRepository {
  async create(workspaceId: string, name: string, key: string, description: string | null, type: string, createdById: string) {
    const rows = await execSpOne('usp_Project_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier,  value: workspaceId },
      { name: 'Name',        type: sql.NVarChar(255),     value: name },
      { name: 'Key',         type: sql.NVarChar(20),      value: key.toUpperCase() },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: description ?? null },
      { name: 'Type',        type: sql.NVarChar(20),      value: type ?? 'KANBAN' },
      { name: 'CreatedById', type: sql.UniqueIdentifier,  value: createdById },
    ]);
    return rows[0];
  }

  async list(workspaceId: string) {
    const rows = await execSpOne('usp_Project_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rows;
  }

  async getById(id: string) {
    const rows = await execSpOne('usp_Project_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Project_GetWorkspaceId', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async update(id: string, fields: {
    name?: string;
    description?: string | null;
    avatarUrl?: string | null;
    type?: string;
    startDate?: Date | null;
    endDate?: Date | null;
    visibility?: 'PUBLIC' | 'PRIVATE';
    maxSubtaskDepth?: number | null;
    multipleAssignees?: boolean;
  }) {
    const rows = await execSpOne('usp_Project_Update', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: id },
      { name: 'Name',        type: sql.NVarChar(255),     value: fields.name ?? null },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: fields.description ?? null },
      { name: 'AvatarUrl',   type: sql.NVarChar(500),     value: fields.avatarUrl ?? null },
      { name: 'Type',        type: sql.NVarChar(20),      value: fields.type ?? null },
      { name: 'StartDate',   type: sql.Date,              value: fields.startDate ?? null },
      { name: 'EndDate',     type: sql.Date,              value: fields.endDate ?? null },
      { name: 'Visibility',      type: sql.NVarChar(10), value: fields.visibility ?? null },
      { name: 'MaxSubtaskDepth', type: sql.Int,          value: fields.maxSubtaskDepth ?? null },
      { name: 'MultipleAssignees', type: sql.Bit,        value: fields.multipleAssignees == null ? null : (fields.multipleAssignees ? 1 : 0) },
    ]);
    return rows[0] ?? null;
  }

  async archive(id: string) {
    const rows = await execSpOne('usp_Project_Archive', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await execSpOne('usp_Project_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }
}
