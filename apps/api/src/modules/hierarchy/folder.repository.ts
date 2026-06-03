import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export class FolderRepository {
  async create(p: { id: string; workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position: number; path: string }) {
    const rows = await execSpOne('usp_Folder_Create', [
      { name: 'Id',             type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId',    type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'SpaceId',        type: sql.UniqueIdentifier, value: p.spaceId },
      { name: 'ParentFolderId', type: sql.UniqueIdentifier, value: p.parentFolderId ?? null },
      { name: 'Name',           type: sql.NVarChar(255),    value: p.name },
      { name: 'Position',       type: sql.Float,            value: p.position },
      { name: 'Path',           type: sql.NVarChar(900),    value: p.path },
    ]);
    return rows[0];
  }
  async list(spaceId: string) {
    return execSpOne('usp_Folder_List', [{ name: 'SpaceId', type: sql.UniqueIdentifier, value: spaceId }]);
  }
  async getById(id: string) {
    const rows = await execSpOne('usp_Folder_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ?? null;
  }
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Folder_GetWorkspaceId', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }
  async update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) {
    const rows = await execSpOne('usp_Folder_Update', [
      { name: 'Id',            type: sql.UniqueIdentifier, value: id },
      { name: 'Name',          type: sql.NVarChar(255),    value: name ?? null },
      { name: 'WorkflowId',    type: sql.UniqueIdentifier, value: workflowId ?? null },
      { name: 'ClearWorkflow', type: sql.Bit,              value: clearWorkflow ? 1 : 0 },
    ]);
    return rows[0];
  }
  async move(id: string, newParentFolderId: string | null, newPosition: number, newPath: string) {
    const rows = await execSpOne('usp_Folder_Move', [
      { name: 'Id',                type: sql.UniqueIdentifier, value: id },
      { name: 'NewParentFolderId', type: sql.UniqueIdentifier, value: newParentFolderId ?? null },
      { name: 'NewPosition',       type: sql.Float,            value: newPosition },
      { name: 'NewPath',           type: sql.NVarChar(900),    value: newPath },
    ]);
    return rows[0];
  }
  async softDelete(id: string) {
    const rows = await execSpOne('usp_Folder_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0];
  }
}
