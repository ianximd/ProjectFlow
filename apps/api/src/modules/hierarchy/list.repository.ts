import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export class ListRepository {
  async create(p: { id: string; workspaceId: string; spaceId: string; folderId: string | null; name: string; position: number; path: string; isDefault?: boolean }) {
    const rows = await execSpOne('usp_List_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'SpaceId',     type: sql.UniqueIdentifier, value: p.spaceId },
      { name: 'FolderId',    type: sql.UniqueIdentifier, value: p.folderId ?? null },
      { name: 'Name',        type: sql.NVarChar(255),    value: p.name },
      { name: 'Position',    type: sql.Float,            value: p.position },
      { name: 'Path',        type: sql.NVarChar(900),    value: p.path },
      { name: 'IsDefault',   type: sql.Bit,              value: p.isDefault ? 1 : 0 },
    ]);
    return rows[0];
  }
  async list(spaceId: string, folderId: string | null, allInSpace = true) {
    return execSpOne('usp_List_List', [
      { name: 'SpaceId',    type: sql.UniqueIdentifier, value: spaceId },
      { name: 'FolderId',   type: sql.UniqueIdentifier, value: folderId ?? null },
      { name: 'AllInSpace', type: sql.Bit,              value: allInSpace ? 1 : 0 },
    ]);
  }
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_List_GetWorkspaceId', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }
  async update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) {
    const rows = await execSpOne('usp_List_Update', [
      { name: 'Id',            type: sql.UniqueIdentifier, value: id },
      { name: 'Name',          type: sql.NVarChar(255),    value: name ?? null },
      { name: 'WorkflowId',    type: sql.UniqueIdentifier, value: workflowId ?? null },
      { name: 'ClearWorkflow', type: sql.Bit,              value: clearWorkflow ? 1 : 0 },
    ]);
    return rows[0];
  }
  async move(id: string, newFolderId: string | null, newPosition: number, newPath: string) {
    const rows = await execSpOne('usp_List_Move', [
      { name: 'Id',          type: sql.UniqueIdentifier, value: id },
      { name: 'NewFolderId', type: sql.UniqueIdentifier, value: newFolderId ?? null },
      { name: 'NewPosition', type: sql.Float,            value: newPosition },
      { name: 'NewPath',     type: sql.NVarChar(900),    value: newPath },
    ]);
    return rows[0];
  }
  async softDelete(id: string) {
    const rows = await execSpOne('usp_List_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0];
  }
  async effectiveStatuses(listId: string) {
    return execSpOne('usp_List_EffectiveStatuses', [{ name: 'ListId', type: sql.UniqueIdentifier, value: listId }]);
  }
}
