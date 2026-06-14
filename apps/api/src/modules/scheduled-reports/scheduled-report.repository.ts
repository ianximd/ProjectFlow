import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  ScheduledReport, ScheduledReportRun, ScheduledReportStatus, DeliveryChannel, RecurrenceRule,
} from '@projectflow/types';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
}

/** Map a ScheduledReports SP row (PascalCase, SELECT *) to the camelCase contract. */
export function mapScheduleRow(r: any): ScheduledReport {
  return {
    id:              r.Id,
    workspaceId:     r.WorkspaceId,
    dashboardId:     r.DashboardId ?? null,
    reportKind:      r.ReportKind ?? null,
    reportParams:    parseJson<Record<string, unknown> | null>(r.ReportParams, null),
    cadence:         parseJson<RecurrenceRule>(r.Cadence, { freq: 'daily', interval: 1 } as RecurrenceRule),
    deliveryChannel: (r.DeliveryChannel as DeliveryChannel) ?? 'inbox',
    recipients:      parseJson<string[]>(r.Recipients, []),
    enabled:         !!r.Enabled,
    nextRunAt:       r.NextRunAt ? new Date(r.NextRunAt).toISOString() : null,
    ownerId:         r.OwnerId,
    createdAt:       String(r.CreatedAt),
    updatedAt:       String(r.UpdatedAt),
  };
}

export function mapRunRow(r: any): ScheduledReportRun {
  return {
    id:                r.Id,
    scheduledReportId: r.ScheduledReportId,
    periodKey:         r.PeriodKey,
    ranAt:             String(r.RanAt),
    status:            (r.Status as ScheduledReportStatus) ?? 'delivered',
    snapshotRef:       r.SnapshotRef ?? null,
    error:             r.Error ?? null,
  };
}

export class ScheduledReportRepository {
  async create(p: {
    workspaceId: string; dashboardId: string | null; reportKind: string | null;
    reportParams: string | null; cadence: string; deliveryChannel: DeliveryChannel;
    recipients: string; nextRunAt: Date | null; ownerId: string;
  }): Promise<ScheduledReport> {
    const rows = await execSpOne('usp_ScheduledReport_Create', [
      { name: 'WorkspaceId',     type: sql.UniqueIdentifier,  value: p.workspaceId },
      { name: 'DashboardId',     type: sql.UniqueIdentifier,  value: p.dashboardId },
      { name: 'ReportKind',      type: sql.NVarChar(24),      value: p.reportKind },
      { name: 'ReportParams',    type: sql.NVarChar(sql.MAX), value: p.reportParams },
      { name: 'Cadence',         type: sql.NVarChar(sql.MAX), value: p.cadence },
      { name: 'DeliveryChannel', type: sql.NVarChar(10),      value: p.deliveryChannel },
      { name: 'Recipients',      type: sql.NVarChar(sql.MAX), value: p.recipients },
      { name: 'NextRunAt',       type: sql.DateTime2,         value: p.nextRunAt },
      { name: 'OwnerId',         type: sql.UniqueIdentifier,  value: p.ownerId },
    ]);
    return mapScheduleRow(rows[0]);
  }

  async update(id: string, p: {
    cadence?: string | null; deliveryChannel?: DeliveryChannel | null;
    recipients?: string | null; enabled?: boolean | null; nextRunAt?: Date | null;
  }): Promise<ScheduledReport | null> {
    const rows = await execSpOne('usp_ScheduledReport_Update', [
      { name: 'Id',              type: sql.UniqueIdentifier,  value: id },
      { name: 'Cadence',         type: sql.NVarChar(sql.MAX), value: p.cadence ?? null },
      { name: 'DeliveryChannel', type: sql.NVarChar(10),      value: p.deliveryChannel ?? null },
      { name: 'Recipients',      type: sql.NVarChar(sql.MAX), value: p.recipients ?? null },
      { name: 'Enabled',         type: sql.Bit,               value: p.enabled == null ? null : (p.enabled ? 1 : 0) },
      { name: 'NextRunAt',       type: sql.DateTime2,         value: p.nextRunAt ?? null },
    ]);
    return rows[0] ? mapScheduleRow(rows[0]) : null;
  }

  async delete(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_ScheduledReport_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }

  async getById(id: string): Promise<ScheduledReport | null> {
    const rows = await execSpOne('usp_ScheduledReport_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapScheduleRow(rows[0]) : null;
  }

  async listByWorkspace(workspaceId: string): Promise<ScheduledReport[]> {
    const rows = await execSpOne('usp_ScheduledReport_ListByWorkspace', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as any[]).map(mapScheduleRow);
  }

  async listDue(now: Date): Promise<ScheduledReport[]> {
    const rows = await execSpOne('usp_ScheduledReport_ListDue', [
      { name: 'Now', type: sql.DateTime2, value: now },
    ]);
    return (rows as any[]).map(mapScheduleRow);
  }

  async advance(id: string, nextRunAt: Date | null): Promise<ScheduledReport | null> {
    const rows = await execSpOne('usp_ScheduledReport_Advance', [
      { name: 'Id',        type: sql.UniqueIdentifier, value: id },
      { name: 'NextRunAt', type: sql.DateTime2,        value: nextRunAt },
      { name: 'Enabled',   type: sql.Bit,              value: null },
    ]);
    return rows[0] ? mapScheduleRow(rows[0]) : null;
  }

  /** Idempotent run record. Returns { inserted, run }: inserted=false on a
   *  duplicate (ScheduledReportId, PeriodKey) — the caller skips delivery. */
  async recordRun(p: {
    scheduledReportId: string; periodKey: string; status: ScheduledReportStatus;
    snapshotRef: string | null; error: string | null;
  }): Promise<{ inserted: boolean; run: ScheduledReportRun | null }> {
    const sets = await execSp('usp_ScheduledReportRun_Record', [
      { name: 'ScheduledReportId', type: sql.UniqueIdentifier,  value: p.scheduledReportId },
      { name: 'PeriodKey',         type: sql.NVarChar(40),      value: p.periodKey },
      { name: 'Status',            type: sql.NVarChar(12),      value: p.status },
      { name: 'SnapshotRef',       type: sql.NVarChar(sql.MAX), value: p.snapshotRef },
      { name: 'Error',             type: sql.NVarChar(sql.MAX), value: p.error },
    ]);
    const inserted = Number((sets[0]?.[0] as any)?.Inserted ?? 0) === 1;
    const runRow   = sets[1]?.[0] as any | undefined;
    return { inserted, run: runRow ? mapRunRow(runRow) : null };
  }

  async listRuns(scheduledReportId: string, page = 1, pageSize = 20): Promise<{ runs: ScheduledReportRun[]; totalCount: number }> {
    const sets = await execSp('usp_ScheduledReportRun_ListBySchedule', [
      { name: 'ScheduledReportId', type: sql.UniqueIdentifier, value: scheduledReportId },
      { name: 'Page',              type: sql.Int,              value: page },
      { name: 'PageSize',          type: sql.Int,              value: pageSize },
    ]);
    const runs = (sets[0] as any[]).map(mapRunRow);
    const totalCount = Number((sets[1]?.[0] as any)?.TotalCount ?? 0);
    return { runs, totalCount };
  }
}

export const scheduledReportRepository = new ScheduledReportRepository();
