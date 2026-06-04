import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { mapTagRow } from './map.js';
import type { Tag } from '@projectflow/types';

export class TagRepository {
  async list(spaceId: string): Promise<Tag[]> {
    const rows = await execSpOne('usp_Tag_List', [{ name: 'SpaceId', type: sql.UniqueIdentifier, value: spaceId }]);
    return (rows as any[]).map(mapTagRow);
  }

  async create(id: string, spaceId: string, name: string, color: string | null): Promise<Tag> {
    const rows = await execSpOne('usp_Tag_Create', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'SpaceId', type: sql.UniqueIdentifier, value: spaceId },
      { name: 'Name', type: sql.NVarChar(100), value: name },
      { name: 'Color', type: sql.NVarChar(7), value: color },
    ]);
    return mapTagRow(rows[0]);
  }

  async delete(id: string): Promise<void> {
    await execSpOne('usp_Tag_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
  }

  async linkTask(taskId: string, tagId: string): Promise<void> {
    await execSpOne('usp_Tag_LinkTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'TagId', type: sql.UniqueIdentifier, value: tagId },
    ]);
  }

  async unlinkTask(taskId: string, tagId: string): Promise<void> {
    await execSpOne('usp_Tag_UnlinkTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'TagId', type: sql.UniqueIdentifier, value: tagId },
    ]);
  }

  async listForTask(taskId: string): Promise<Tag[]> {
    const rows = await execSpOne('usp_Tag_ListForTask', [{ name: 'TaskId', type: sql.UniqueIdentifier, value: taskId }]);
    return (rows as any[]).map(mapTagRow);
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Tag_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }
}
