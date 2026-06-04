import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { mapTaskTypeRow } from './map.js';
import type { TaskType } from '@projectflow/types';

export class TaskTypeRepository {
  async list(workspaceId: string): Promise<TaskType[]> {
    const rows = await execSpOne('usp_TaskType_List',
      [{ name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId }]);
    return (rows as any[]).map(mapTaskTypeRow);
  }

  async create(p: {
    id: string; workspaceId: string; nameSingular: string; namePlural: string;
    icon: string | null; isMilestone: boolean; position: number;
  }): Promise<TaskType> {
    const rows = await execSpOne('usp_TaskType_Create', [
      { name: 'Id', type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'NameSingular', type: sql.NVarChar(100), value: p.nameSingular },
      { name: 'NamePlural', type: sql.NVarChar(100), value: p.namePlural },
      { name: 'Icon', type: sql.NVarChar(50), value: p.icon },
      { name: 'IsMilestone', type: sql.Bit, value: p.isMilestone ? 1 : 0 },
      { name: 'Position', type: sql.Float, value: p.position },
    ]);
    return mapTaskTypeRow(rows[0]);
  }

  async update(id: string, p: {
    nameSingular?: string; namePlural?: string; icon?: string | null; clearIcon?: boolean; position?: number;
  }): Promise<TaskType | null> {
    const rows = await execSpOne('usp_TaskType_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'NameSingular', type: sql.NVarChar(100), value: p.nameSingular ?? null },
      { name: 'NamePlural', type: sql.NVarChar(100), value: p.namePlural ?? null },
      { name: 'Icon', type: sql.NVarChar(50), value: p.icon ?? null },
      { name: 'ClearIcon', type: sql.Bit, value: p.clearIcon ? 1 : 0 },
      { name: 'Position', type: sql.Float, value: p.position ?? null },
    ]);
    return rows[0] ? mapTaskTypeRow(rows[0]) : null;
  }

  async delete(id: string): Promise<TaskType | null> {
    const rows = await execSpOne('usp_TaskType_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapTaskTypeRow(rows[0]) : null;
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_TaskType_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async getById(id: string): Promise<TaskType | null> {
    const rows = await execSpOne('usp_TaskType_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapTaskTypeRow(rows[0]) : null;
  }

  /** Returns the raw (PascalCase) updated Task row; callers read ProjectId for cache invalidation. */
  async setTaskType(taskId: string, taskTypeId: string, legacyType: string): Promise<Record<string, unknown> | null> {
    const rows = await execSpOne('usp_Task_SetType', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'TaskTypeId', type: sql.UniqueIdentifier, value: taskTypeId },
      { name: 'LegacyType', type: sql.NVarChar(20), value: legacyType },
    ]);
    return (rows[0] as Record<string, unknown>) ?? null;
  }
}
