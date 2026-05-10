import sql from 'mssql';
import { execSp } from '../../shared/lib/sqlClient.js';

export interface SearchTaskRow {
  Id: string;
  IssueKey: string;
  Title: string;
  Type: string;
  Status: string;
  Priority: string;
  StoryPoints: number | null;
  DueDate: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  ProjectId: string;
  ProjectName: string;
  ProjectKey: string;
  SprintId: string | null;
  ReporterId: string;
  TotalCount: number;
}

export interface SearchParams {
  workspaceId: string;
  projectId?: string | null;
  q?: string | null;
  type?: string | null;
  status?: string | null;
  priority?: string | null;
  assigneeId?: string | null;
  reporterId?: string | null;
  sprintId?: string | null;
  openSprints?: boolean;
  dueAfter?: string | null;
  dueBefore?: string | null;
  createdAfter?: string | null;
  updatedAfter?: string | null;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
  page?: number;
  pageSize?: number;
}

export class SearchRepository {
  async search(p: SearchParams): Promise<{ tasks: SearchTaskRow[]; total: number }> {
    const sets = await execSp('usp_Task_Search_PQL', [
      { name: 'WorkspaceId',  type: sql.UniqueIdentifier,   value: p.workspaceId },
      { name: 'ProjectId',    type: sql.UniqueIdentifier,   value: p.projectId   ?? null },
      { name: 'Query',        type: sql.NVarChar(500),      value: p.q           ?? null },
      { name: 'Type',         type: sql.NVarChar(20),       value: p.type        ?? null },
      { name: 'Status',       type: sql.NVarChar(100),      value: p.status      ?? null },
      { name: 'Priority',     type: sql.NVarChar(20),       value: p.priority    ?? null },
      { name: 'AssigneeId',   type: sql.UniqueIdentifier,   value: p.assigneeId  ?? null },
      { name: 'ReporterId',   type: sql.UniqueIdentifier,   value: p.reporterId  ?? null },
      { name: 'SprintId',     type: sql.UniqueIdentifier,   value: p.sprintId    ?? null },
      { name: 'OpenSprints',  type: sql.Bit,                value: p.openSprints ? 1 : 0 },
      { name: 'DueAfter',     type: sql.Date,               value: p.dueAfter    ?? null },
      { name: 'DueBefore',    type: sql.Date,               value: p.dueBefore   ?? null },
      { name: 'CreatedAfter', type: sql.DateTime2,          value: p.createdAfter ?? null },
      { name: 'UpdatedAfter', type: sql.DateTime2,          value: p.updatedAfter ?? null },
      { name: 'OrderBy',      type: sql.NVarChar(50),       value: p.orderBy  ?? 'CreatedAt' },
      { name: 'OrderDir',     type: sql.NVarChar(4),        value: p.orderDir ?? 'DESC' },
      { name: 'Page',         type: sql.Int,                value: p.page     ?? 1 },
      { name: 'PageSize',     type: sql.Int,                value: p.pageSize ?? 25 },
    ]);
    const rows  = sets[0] as SearchTaskRow[];
    const total = rows[0]?.TotalCount ?? 0;
    return { tasks: rows, total };
  }
}
