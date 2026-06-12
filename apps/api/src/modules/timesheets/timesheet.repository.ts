import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { Timesheet, TimesheetAggregate, TimesheetAggregateRow, TimesheetAggregateTotals } from '@projectflow/types';

interface TimesheetRow {
  Id: string; WorkspaceId: string; UserId: string;
  PeriodStart: Date | string; PeriodEnd: Date | string; Status: string;
  SubmittedAt: Date | null; ReviewedById: string | null; ReviewedAt: Date | null;
  Note: string | null; CreatedAt: Date; UpdatedAt: Date;
}
interface AggRow {
  WorkDate: Date | string; TaskId: string; TaskTitle: string;
  TotalSeconds: number; BillableSeconds: number; NonBillableSeconds: number;
}
interface AggTotalsRow { TotalSeconds: number | null; BillableSeconds: number | null; NonBillableSeconds: number | null; }

const iso     = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));
const isoDate = (v: Date | string) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

function rowToTimesheet(r: TimesheetRow): Timesheet {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, userId: r.UserId,
    periodStart: isoDate(r.PeriodStart), periodEnd: isoDate(r.PeriodEnd),
    status: r.Status as Timesheet['status'],
    submittedAt: r.SubmittedAt ? iso(r.SubmittedAt) : null,
    reviewedById: r.ReviewedById, reviewedAt: r.ReviewedAt ? iso(r.ReviewedAt) : null,
    note: r.Note, createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt),
  };
}

export class TimesheetRepository {
  async getOrCreate(workspaceId: string, userId: string, periodStart: string, periodEnd: string): Promise<Timesheet> {
    const rows = await execSpOne<TimesheetRow>('usp_Timesheet_GetOrCreate', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'PeriodStart', type: sql.Date,             value: periodStart },
      { name: 'PeriodEnd',   type: sql.Date,             value: periodEnd },
    ]);
    return rowToTimesheet(rows[0]);
  }

  async getById(id: string): Promise<Timesheet | null> {
    const rows = await execSpOne<TimesheetRow>('usp_Timesheet_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? rowToTimesheet(rows[0]) : null;
  }

  async list(workspaceId: string, userId: string): Promise<Timesheet[]> {
    const rows = await execSpOne<TimesheetRow>('usp_Timesheet_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
    ]);
    return Array.from(rows).map(rowToTimesheet);
  }

  async aggregate(timesheetId: string): Promise<TimesheetAggregate> {
    const sets = await execSp<AggRow | AggTotalsRow>('usp_Timesheet_Aggregate', [
      { name: 'TimesheetId', type: sql.UniqueIdentifier, value: timesheetId },
    ]);
    const rows = (sets[0] as AggRow[]).map((r): TimesheetAggregateRow => ({
      workDate: isoDate(r.WorkDate), taskId: r.TaskId, taskTitle: r.TaskTitle,
      totalSeconds: r.TotalSeconds, billableSeconds: r.BillableSeconds, nonBillableSeconds: r.NonBillableSeconds,
    }));
    const t = ((sets[1] ?? [])[0] ?? {}) as AggTotalsRow;
    const totals: TimesheetAggregateTotals = {
      totalSeconds: t.TotalSeconds ?? 0, billableSeconds: t.BillableSeconds ?? 0, nonBillableSeconds: t.NonBillableSeconds ?? 0,
    };
    return { rows, totals };
  }

  async submit(id: string, userId: string, note: string | null): Promise<Timesheet | null> {
    const rows = await execSpOne<TimesheetRow>('usp_Timesheet_Submit', [
      { name: 'Id',     type: sql.UniqueIdentifier, value: id },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
      { name: 'Note',   type: sql.NVarChar(500),    value: note },
    ]);
    return rows[0] ? rowToTimesheet(rows[0]) : null;
  }

  async review(id: string, reviewerId: string, decision: 'approved' | 'rejected', note: string | null): Promise<Timesheet | null> {
    const rows = await execSpOne<TimesheetRow>('usp_Timesheet_Review', [
      { name: 'Id',         type: sql.UniqueIdentifier, value: id },
      { name: 'ReviewerId', type: sql.UniqueIdentifier, value: reviewerId },
      { name: 'Decision',   type: sql.NVarChar(12),     value: decision },
      { name: 'Note',       type: sql.NVarChar(500),    value: note },
    ]);
    return rows[0] ? rowToTimesheet(rows[0]) : null;
  }
}
