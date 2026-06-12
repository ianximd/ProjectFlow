import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';

export class SprintRepository {
  /**
   * Single-row read. Backs the audit-snapshot fetcher (W43 Option A) so
   * sprint updates surface field-level diffs in AuditLog.
   */
  async getById(id: string): Promise<Record<string, unknown> | null> {
    const rows = await execSpOne<Record<string, unknown>>('usp_Sprint_GetById', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  async create(projectId: string, name: string, goal: string | null, startDate: Date | null, endDate: Date | null) {
    const rows = await execSpOne('usp_Sprint_Create', [
      { name: 'ProjectId', type: sql.UniqueIdentifier,  value: projectId },
      { name: 'Name',      type: sql.NVarChar(255),     value: name },
      { name: 'Goal',      type: sql.NVarChar(sql.MAX), value: goal ?? null },
      { name: 'StartDate', type: sql.DateTime2,         value: startDate ?? null },
      { name: 'EndDate',   type: sql.DateTime2,         value: endDate ?? null },
    ]);
    return rows[0];
  }

  async list(projectId: string) {
    const rows = await execSpOne('usp_Sprint_List', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: projectId },
    ]);
    return rows;
  }

  async start(id: string) {
    const rows = await execSpOne('usp_Sprint_Start', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0];
  }

  async complete(id: string) {
    const rows = await execSpOne('usp_Sprint_Complete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0];
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Sprint_GetWorkspaceId', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  // ── Sprint-folder hierarchy (Phase 8c) ──────────────────────────────────────

  async getSprintSettings(folderId: string) {
    const rows = await execSpOne('usp_Folder_GetSprintSettings', [
      { name: 'FolderId', type: sql.UniqueIdentifier, value: folderId },
    ]);
    return rows[0] ?? null;
  }

  async setSprintSettings(folderId: string, s: {
    durationDays: number; startDayOfWeek: number | null;
    autoStart: boolean; autoComplete: boolean; autoRollForward: boolean;
    pointsFieldId: string | null;
  }) {
    const rows = await execSpOne('usp_Folder_SetSprintSettings', [
      { name: 'FolderId',        type: sql.UniqueIdentifier, value: folderId },
      { name: 'DurationDays',    type: sql.Int,              value: s.durationDays },
      { name: 'StartDayOfWeek',  type: sql.TinyInt,          value: s.startDayOfWeek },
      { name: 'AutoStart',       type: sql.Bit,              value: s.autoStart ? 1 : 0 },
      { name: 'AutoComplete',    type: sql.Bit,              value: s.autoComplete ? 1 : 0 },
      { name: 'AutoRollForward', type: sql.Bit,              value: s.autoRollForward ? 1 : 0 },
      { name: 'PointsFieldId',   type: sql.UniqueIdentifier, value: s.pointsFieldId },
    ]);
    return rows[0];
  }

  async createInFolder(folderId: string, name: string, goal: string | null, startDate: Date | null, endDate: Date | null) {
    const rows = await execSpOne('usp_Sprint_CreateInFolder', [
      { name: 'FolderId',  type: sql.UniqueIdentifier,  value: folderId },
      { name: 'Name',      type: sql.NVarChar(255),     value: name },
      { name: 'Goal',      type: sql.NVarChar(sql.MAX), value: goal ?? null },
      { name: 'StartDate', type: sql.DateTime2,         value: startDate ?? null },
      { name: 'EndDate',   type: sql.DateTime2,         value: endDate ?? null },
    ]);
    return rows[0];
  }

  async rollForward(fromSprintId: string, toSprintId: string): Promise<number> {
    const rows = await execSpOne<{ Rolled: number }>('usp_Sprint_RollForward', [
      { name: 'FromSprintId', type: sql.UniqueIdentifier, value: fromSprintId },
      { name: 'ToSprintId',   type: sql.UniqueIdentifier, value: toSprintId },
    ]);
    return rows[0]?.Rolled ?? 0;
  }

  async getPointsRollup(sprintId: string): Promise<{ total: any; perAssignee: any[] }> {
    const sets = await execSp('usp_Sprint_GetPointsRollup', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: sprintId },
    ]);
    return {
      total: (sets[0]?.[0] as any) ?? { TotalPoints: 0, CompletedPoints: 0 },
      perAssignee: (sets[1] as any[]) ?? [],
    };
  }

  async listDueFolders(): Promise<any[]> {
    const rows = await execSpOne('usp_Sprint_ListDueFolders', []);
    return rows as any[];
  }

  // usp_Folder_GetWorkspaceId pre-dates Phase 8c and takes param @Id (not @FolderId).
  async getFolderWorkspaceId(folderId: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Folder_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: folderId },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }
}
