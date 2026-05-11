import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';

export interface RoadmapItemRow {
  Id: string;
  IssueKey: string;
  Title: string;
  Type: string;
  Status: string;
  Priority: string;
  StartDate: Date | null;
  DueDate: Date | null;
  EpicId: string | null;
  ParentTaskId: string | null;
  StoryPoints: number | null;
  ProjectId: string;
  ProjectName: string;
  ProjectKey: string;
  AssigneesJson: string | null;
  ChildCount: number;
  ChildDoneCount: number;
}

export interface DependencyRow {
  TaskId: string;
  DependsOn: string;
  Type: string;
}

export class RoadmapRepository {
  async getItems(
    projectId: string | null,
    workspaceId: string | null,
    fromDate?: string | null,
    toDate?: string | null,
  ) {
    const sets = await execSp('usp_Roadmap_GetItems', [
      { name: 'ProjectId',   type: sql.UniqueIdentifier, value: projectId   ?? null },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId ?? null },
      { name: 'FromDate',    type: sql.Date,             value: fromDate    ?? null },
      { name: 'ToDate',      type: sql.Date,             value: toDate      ?? null },
    ]);
    const items = (sets[0] ?? []) as RoadmapItemRow[];
    const deps  = (sets[1] ?? []) as DependencyRow[];
    return { items, deps };
  }

  async updateDates(
    taskId: string,
    requesterId: string,
    startDate?: string | null,
    dueDate?: string | null,
    clearStartDate?: boolean,
    clearDueDate?: boolean,
  ) {
    const rows = await execSpOne('usp_Task_UpdateDates', [
      { name: 'TaskId',         type: sql.UniqueIdentifier, value: taskId },
      { name: 'RequesterId',    type: sql.UniqueIdentifier, value: requesterId },
      { name: 'StartDate',      type: sql.Date,             value: startDate ?? null },
      // DueDate is DATETIME2 since migration 0024 — the SP param widened too.
      { name: 'DueDate',        type: sql.DateTime2,        value: dueDate   ?? null },
      { name: 'ClearStartDate', type: sql.Bit,              value: clearStartDate ? 1 : 0 },
      { name: 'ClearDueDate',   type: sql.Bit,              value: clearDueDate   ? 1 : 0 },
    ]);
    return rows[0];
  }

  async addDependency(taskId: string, dependsOn: string, type = 'BLOCKS') {
    const rows = await execSpOne('usp_TaskDependency_Add', [
      { name: 'TaskId',    type: sql.UniqueIdentifier, value: taskId },
      { name: 'DependsOn', type: sql.UniqueIdentifier, value: dependsOn },
      { name: 'Type',      type: sql.NVarChar(20),     value: type },
    ]);
    return rows[0];
  }

  async removeDependency(taskId: string, dependsOn: string) {
    await execSpOne('usp_TaskDependency_Remove', [
      { name: 'TaskId',    type: sql.UniqueIdentifier, value: taskId },
      { name: 'DependsOn', type: sql.UniqueIdentifier, value: dependsOn },
    ]);
  }
}
