import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
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

  /**
   * Atomic CLAIM + advance. Conditional on the row still carrying
   * `expectedNextRunAt` (the value the caller observed) AND Active=1, so a
   * concurrent spawn that already advanced the row loses (claimed=0). When
   * `rule` is provided, the decremented-count Rule JSON is folded into the SAME
   * UPDATE (no separate read-then-write). Returns `{ claimed, row }`: claimed is
   * the @@ROWCOUNT (0 or 1); row is the post-update recurrence (or null).
   */
  async advanceAfterSpawn(p: {
    id: string;
    lastSpawnedTaskId: string;
    nextRunAt: Date | null;
    active: boolean;
    expectedNextRunAt: Date | null;
    rule?: string | null;
  }): Promise<{ claimed: boolean; row: TaskRecurrence | null }> {
    const sets = await execSp('usp_TaskRecurrence_AdvanceAfterSpawn', [
      { name: 'Id',                type: sql.UniqueIdentifier,  value: p.id },
      { name: 'LastSpawnedTaskId', type: sql.UniqueIdentifier,  value: p.lastSpawnedTaskId },
      { name: 'NextRunAt',         type: sql.DateTime2,         value: p.nextRunAt },
      { name: 'Active',            type: sql.Bit,               value: p.active ? 1 : 0 },
      { name: 'ExpectedNextRunAt', type: sql.DateTime2,         value: p.expectedNextRunAt },
      { name: 'Rule',              type: sql.NVarChar(sql.MAX), value: p.rule ?? null },
    ]);
    const claimed = Number((sets[0]?.[0] as any)?.Claimed ?? 0) === 1;
    const rowSet = sets[1] as any[] | undefined;
    return { claimed, row: rowSet?.[0] ? mapRecurrenceRow(rowSet[0]) : null };
  }

  /**
   * Unconditionally stamp LastSpawnedTaskId for an already-claimed recurrence
   * (FIX 1: re-point from the tentatively-recorded source id to the real clone
   * id after the claim has committed). Not gated on Active — the claim may have
   * just deactivated the row on the final occurrence.
   */
  async setLastSpawned(id: string, lastSpawnedTaskId: string): Promise<TaskRecurrence | null> {
    const rows = await execSpOne('usp_TaskRecurrence_SetLastSpawned', [
      { name: 'Id',                type: sql.UniqueIdentifier, value: id },
      { name: 'LastSpawnedTaskId', type: sql.UniqueIdentifier, value: lastSpawnedTaskId },
    ]);
    return rows[0] ? mapRecurrenceRow(rows[0]) : null;
  }
}

export const recurrenceRepository = new RecurrenceRepository();
