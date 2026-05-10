import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { WorkLog, WorkLogTotals, WorkLogListResult } from '@projectflow/types';

interface WorkLogRow {
  Id:               string;
  TaskId:           string;
  UserId:           string;
  UserName:         string;
  AvatarUrl:        string | null;
  TimeSpentSeconds: number;
  StartedAt:        Date;
  Description:      string | null;
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
    description:      row.Description,
    createdAt:        row.CreatedAt instanceof Date  ? row.CreatedAt.toISOString()  : String(row.CreatedAt),
  };
}

export class WorkLogRepository {
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
    description?:     string,
  ): Promise<WorkLog> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_Create', [
      { name: 'TaskId',           type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId',           type: sql.UniqueIdentifier, value: userId },
      { name: 'TimeSpentSeconds', type: sql.Int,              value: timeSpentSeconds },
      { name: 'StartedAt',        type: sql.DateTime2,        value: new Date(startedAt) },
      { name: 'Description',      type: sql.NVarChar(500),    value: description ?? null },
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
    },
  ): Promise<WorkLog | null> {
    const rows = await execSpOne<WorkLogRow>('usp_WorkLog_Update', [
      { name: 'Id',               type: sql.UniqueIdentifier, value: id },
      { name: 'UserId',           type: sql.UniqueIdentifier, value: userId },
      { name: 'TimeSpentSeconds', type: sql.Int,              value: patch.timeSpentSeconds ?? null },
      { name: 'StartedAt',        type: sql.DateTime2,        value: patch.startedAt ? new Date(patch.startedAt) : null },
      { name: 'Description',      type: sql.NVarChar(500),    value: patch.description ?? null },
    ]);
    return rows[0] ? rowToLog(rows[0]) : null;
  }

  async delete(id: string, userId: string): Promise<void> {
    await execSpOne('usp_WorkLog_Delete', [
      { name: 'Id',     type: sql.UniqueIdentifier, value: id },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }
}
