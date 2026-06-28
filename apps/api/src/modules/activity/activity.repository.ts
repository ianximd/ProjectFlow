/**
 * Phase 9e — Activity repository.
 *
 * Thin data-access layer over usp_AuditLog_List. All business logic (authz,
 * scope resolution, post-filtering) lives in ActivityService.
 */

import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { AuditLogEntry, AuditLogPage } from '@projectflow/types';
import type { AuditFilters } from './activity-scope.js';

function safeJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapEntry(r: any): AuditLogEntry {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId ?? null,
    userId:      r.UserId,
    userEmail:   r.UserEmail   ?? null,
    action:      r.Action,
    resource:    r.Resource,
    resourceId:  r.ResourceId  ?? null,
    oldValues:   safeJson(r.OldValues),
    newValues:   safeJson(r.NewValues),
    ipAddress:   r.IpAddress   ?? null,
    userAgent:   r.UserAgent   ?? null,
    createdAt:   r.CreatedAt instanceof Date
      ? r.CreatedAt.toISOString()
      : String(r.CreatedAt),
  };
}

export class ActivityRepository {
  /**
   * Call usp_AuditLog_List with the pre-built filter bag and return a typed
   * page. The TotalCount window column from the SP drives the `total` field.
   */
  async listScoped(filters: AuditFilters): Promise<AuditLogPage> {
    const rows = await execSpOne<any>('dbo.usp_AuditLog_List', [
      { name: 'WorkspaceId', type: sql.NVarChar(255), value: filters.workspaceId ?? null },
      { name: 'UserId',      type: sql.NVarChar(255), value: filters.userId      ?? null },
      { name: 'Resource',    type: sql.NVarChar(100), value: filters.resource    ?? null },
      { name: 'Action',      type: sql.NVarChar(50),  value: filters.action      ?? null },
      { name: 'ResourceId',  type: sql.NVarChar(255), value: filters.resourceId  ?? null },
      { name: 'FromDate',    type: sql.DateTime2,     value: filters.fromDate    ?? null },
      { name: 'ToDate',      type: sql.DateTime2,     value: filters.toDate      ?? null },
      { name: 'Page',        type: sql.Int,           value: filters.page },
      { name: 'PageSize',    type: sql.Int,           value: filters.pageSize },
    ]);

    const total   = rows[0]?.TotalCount ?? 0;
    const entries = rows.map(mapEntry);
    return { entries, total, page: filters.page, pageSize: filters.pageSize };
  }
}

export const activityRepository = new ActivityRepository();
