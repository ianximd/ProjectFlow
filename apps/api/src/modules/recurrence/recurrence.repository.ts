import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { TaskRecurrence, RecurrenceRule, RecurrenceMode } from '@projectflow/types';

/** Map a TaskRecurrences SP row (PascalCase, SELECT *) to the camelCase contract. */
export function mapRecurrenceRow(r: any): TaskRecurrence {
  let rule: RecurrenceRule;
  try { rule = JSON.parse(String(r.Rule)); } catch { rule = { freq: 'daily', interval: 1 } as RecurrenceRule; }
  return {
    id: r.Id,
    taskId: r.TaskId,
    workspaceId: r.WorkspaceId,
    rule,
    regenerateMode: r.RegenerateMode as RecurrenceMode,
    nextRunAt: r.NextRunAt ? new Date(r.NextRunAt).toISOString() : null,
    active: !!r.Active,
    lastSpawnedTaskId: r.LastSpawnedTaskId ?? null,
    includeDependencies: !!r.IncludeDependencies,
    createdAt: String(r.CreatedAt),
    updatedAt: String(r.UpdatedAt),
  };
}

export class RecurrenceRepository {
  async getForTask(taskId: string): Promise<TaskRecurrence | null> {
    const rows = await execSpOne('usp_TaskRecurrence_GetForTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows[0] ? mapRecurrenceRow(rows[0]) : null;
  }

  async setForTask(p: {
    taskId: string;
    workspaceId: string;
    ruleJson: string;
    regenerateMode: RecurrenceMode;
    nextRunAt: Date | null;
    includeDependencies: boolean;
  }): Promise<TaskRecurrence> {
    const rows = await execSpOne('usp_TaskRecurrence_SetForTask', [
      { name: 'TaskId',              type: sql.UniqueIdentifier,  value: p.taskId },
      { name: 'WorkspaceId',         type: sql.UniqueIdentifier,  value: p.workspaceId },
      { name: 'Rule',                type: sql.NVarChar(sql.MAX), value: p.ruleJson },
      { name: 'RegenerateMode',      type: sql.NVarChar(20),      value: p.regenerateMode },
      { name: 'NextRunAt',           type: sql.DateTime2,         value: p.nextRunAt },
      { name: 'IncludeDependencies', type: sql.Bit,               value: p.includeDependencies ? 1 : 0 },
    ]);
    return mapRecurrenceRow(rows[0]);
  }

  async clear(taskId: string): Promise<number> {
    const rows = await execSpOne<{ Cleared: number }>('usp_TaskRecurrence_Clear', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows[0]?.Cleared ?? 0;
  }

  async listDue(now: Date): Promise<TaskRecurrence[]> {
    const rows = await execSpOne('usp_TaskRecurrence_ListDue', [
      { name: 'Now', type: sql.DateTime2, value: now },
    ]);
    return (rows as any[]).map(mapRecurrenceRow);
  }

  async advanceAfterSpawn(p: {
    id: string;
    lastSpawnedTaskId: string;
    nextRunAt: Date | null;
    active: boolean;
  }): Promise<TaskRecurrence | null> {
    const rows = await execSpOne('usp_TaskRecurrence_AdvanceAfterSpawn', [
      { name: 'Id',                type: sql.UniqueIdentifier, value: p.id },
      { name: 'LastSpawnedTaskId', type: sql.UniqueIdentifier, value: p.lastSpawnedTaskId },
      { name: 'NextRunAt',         type: sql.DateTime2,        value: p.nextRunAt },
      { name: 'Active',            type: sql.Bit,              value: p.active ? 1 : 0 },
    ]);
    return rows[0] ? mapRecurrenceRow(rows[0]) : null;
  }
}

export const recurrenceRepository = new RecurrenceRepository();
