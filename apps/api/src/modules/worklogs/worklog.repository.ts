import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { WorkLog, WorkLogTotals, WorkLogListResult, TaskTimeRollup, WorkLogTag } from '@projectflow/types';

interface WorkLogRow {
  Id:               string;
  TaskId:           string;
  UserId:           string;
  UserName:         string;
  AvatarUrl:        string | null;
  TimeSpentSeconds: number;
  StartedAt:        Date;
  EndedAt:          Date | null;
  Description:      string | null;
  Billable:         boolean;
  Source:           string;
  CreatedAt:        Date;
}

interface TotalsRow {
  UserId:       string;
  UserName:     string;
  AvatarUrl:    string | null;
  TotalSeconds: number;
}

function rowToLog(row: WorkLogRow): WorkLog {
  return {
    id:               row.Id,
    taskId:           row.TaskId,
    user:             { id: row.UserId, name: row.UserName, avatarUrl: row.AvatarUrl },
    timeSpentSeconds: row.TimeSpentSeconds,
    startedAt:        row.StartedAt instanceof Date ? row.StartedAt.toISOString() : String(row.StartedAt),
    endedAt:          row.EndedAt == null ? null : (row.EndedAt instanceof Date ? row.EndedAt.toISOString() : String(row.EndedAt)),
    description:      row.Description,
    billable:         Boolean(row.Billable),
    source:           (row.Source as WorkLog['source']) ?? 'manual',
    createdAt:        row.CreatedAt instanceof Date  ? row.CreatedAt.toISOString()  : String(row.CreatedAt),
  };
}

export class WorkLogRepository {
  /**
   * Single-row read. Backs the audit-snapshot fetcher (W43 Option A) so
   * worklog updates surface field-level diffs in AuditLog.
   */
  async getById(id: string): Promise<Record<string, unknown> | null> {
    const rows = await execSpOne<Record<string, unknown>>('usp_WorkLog_GetById', [
      { name: 'WorkLogId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  /**
   * Phase 8b period-lock: true when a submitted/approved Timesheet for this user
   * covers the given work date, so the create/update write path can reject it.
   */
  async isPeriodLocked(userId: string, workDate: string): Promise<boolean> {
    const rows = await execSpOne<{ IsLocked: boolean }>('usp_WorkLog_PeriodLocked', [
      { name: 'UserId',   type: sql.UniqueIdentifier, value: userId },
      { name: 'WorkDate', type: sql.Date,             value: workDate.slice(0, 10) },
    ]);
    return Boolean(rows[0]?.IsLocked);
  }

  async listByTask(taskId: string): Promise<WorkLogListResult> {
    const sets = await execSp<WorkLogRow | TotalsRow>('usp_WorkLog_ListByTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);

    const logs   = (sets[0] as WorkLogRow[]).map(rowToLog);
    const totals = ((sets[1] ?? []) as TotalsRow[]).map((r): WorkLogTotals => ({
      user:         { id: r.UserId, name: r.UserName, avatarUrl: r.AvatarUrl },
      totalSeconds: r.TotalSeconds,
    }));

    return { logs, totals };
  }

  async create(
    taskId:           string,
    userId:           string,
    timeSpentSeconds: number,
    startedAt:        string,
    opts: {
      description?: string;
      billable?:    boolean;
      source?:      WorkLog['source'];
      endedAt?:     string;
    } = {},
  ): Promise<WorkLog> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_Create', [
      { name: 'TaskId',           type: sql.UniqueIdentifier,   value: taskId },
      { name: 'UserId',           type: sql.UniqueIdentifier,   value: userId },
      { name: 'TimeSpentSeconds', type: sql.Int,                value: timeSpentSeconds },
      { name: 'StartedAt',        type: sql.DateTime2,          value: new Date(startedAt) },
      { name: 'Description',      type: sql.NVarChar(500),      value: opts.description ?? null },
      { name: 'Billable',         type: sql.Bit,                value: opts.billable ?? false },
      { name: 'Source',           type: sql.NVarChar(10),       value: opts.source ?? 'manual' },
      { name: 'EndedAt',          type: sql.DateTime2,          value: opts.endedAt ? new Date(opts.endedAt) : null },
    ]);
    return rowToLog(rows[0]);
  }

  async update(
    id:     string,
    userId: string,
    patch: {
      timeSpentSeconds?: number;
      startedAt?:        string;
      description?:      string;
      billable?:         boolean;
      endedAt?:          string;
    },
  ): Promise<WorkLog | null> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_Update', [
      { name: 'Id',               type: sql.UniqueIdentifier, value: id },
      { name: 'UserId',           type: sql.UniqueIdentifier, value: userId },
      { name: 'TimeSpentSeconds', type: sql.Int,              value: patch.timeSpentSeconds ?? null },
      { name: 'StartedAt',        type: sql.DateTime2,        value: patch.startedAt ? new Date(patch.startedAt) : null },
      { name: 'Description',      type: sql.NVarChar(500),    value: patch.description ?? null },
      { name: 'Billable',         type: sql.Bit,              value: patch.billable ?? null },
      { name: 'EndedAt',          type: sql.DateTime2,        value: patch.endedAt ? new Date(patch.endedAt) : null },
    ]);
    return rows[0] ? rowToLog(rows[0]) : null;
  }

  async startTimer(taskId: string, userId: string): Promise<WorkLog> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_StartTimer', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rowToLog(rows[0]);
  }

  async stopTimer(userId: string): Promise<WorkLog | null> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_StopTimer', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows[0] ? rowToLog(rows[0]) : null;
  }

  async getActiveTimer(userId: string): Promise<WorkLog | null> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_GetActiveTimer', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows[0] ? rowToLog(rows[0]) : null;
  }

  async setTags(workLogId: string, tagIds: string[]): Promise<WorkLogTag[]> {
    const rows = await execSpOne<{ Id: string; Name: string; Color: string | null }>('usp_WorkLogTag_Set', [
      { name: 'WorkLogId', type: sql.UniqueIdentifier,  value: workLogId },
      { name: 'TagIds',    type: sql.NVarChar(sql.MAX), value: tagIds.length ? tagIds.join(',') : null },
    ]);
    return Array.from(rows).map((r) => ({ id: r.Id, name: r.Name, color: r.Color }));
  }

  async setEstimate(taskId: string, userId: string | null, estimateSeconds: number | null): Promise<void> {
    await execSpOne('usp_Task_SetEstimate', [
      { name: 'TaskId',          type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId',          type: sql.UniqueIdentifier, value: userId },
      { name: 'EstimateSeconds', type: sql.Int,              value: estimateSeconds },
    ]);
  }

  async getTimeRollup(taskId: string): Promise<TaskTimeRollup> {
    const rows = await execSpOne<{
      TaskId:                string;
      OwnLoggedSeconds:      number;
      OwnEstimateSeconds:    number | null;
      RollupLoggedSeconds:   number;
      RollupEstimateSeconds: number;
    }>('usp_Task_GetTimeRollup', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    const r = rows[0];
    return {
      taskId:                r.TaskId,
      ownLoggedSeconds:      r.OwnLoggedSeconds,
      ownEstimateSeconds:    r.OwnEstimateSeconds,
      rollupLoggedSeconds:   r.RollupLoggedSeconds,
      rollupEstimateSeconds: r.RollupEstimateSeconds,
    };
  }

  async getContext(id: string): Promise<{ workspaceId: string; ownerId: string } | null> {
    const rows = await execSpOne<{ WorkspaceId: string; OwnerId: string }>('usp_WorkLog_GetContext', [
      { name: 'WorkLogId', type: sql.UniqueIdentifier, value: id },
    ]);
    const r = rows[0];
    return r ? { workspaceId: r.WorkspaceId, ownerId: r.OwnerId } : null;
  }

  async delete(id: string, userId: string): Promise<void> {
    await execSpOne('usp_WorkLog_Delete', [
      { name: 'Id',     type: sql.UniqueIdentifier, value: id },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }
}
