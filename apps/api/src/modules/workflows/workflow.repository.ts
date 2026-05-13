import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';

export interface WorkflowRow {
  Id: string;
  ProjectId: string;
  Name: string;
  IsDefault: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

export interface WorkflowStatusRow {
  Id: string;
  WorkflowId: string;
  Name: string;
  Category: string;
  Color: string;
  Position: number;
  CreatedAt: Date;
}

export interface WorkflowTransitionRow {
  Id: string;
  WorkflowId: string;
  FromStatus: string;
  ToStatus: string;
  Name: string | null;
  CreatedAt: Date;
}

export class WorkflowRepository {
  /**
   * Single-row read of the top-level Workflow row. Backs the audit-
   * snapshot fetcher (W43 Option A). Sub-resources (statuses,
   * transitions) live in their own tables and aren't joined here —
   * PATCH /workflows/:id/statuses/:statusId passes the *status* id as
   * the audit resourceId, which won't match a Workflow row, so the
   * snapshot just comes back null and the audit row gets no diff.
   */
  async getById(id: string): Promise<Record<string, unknown> | null> {
    const rows = await execSpOne<Record<string, unknown>>('usp_Workflow_GetById', [
      { name: 'WorkflowId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  async create(projectId: string, name: string, template: string) {
    const sets = await execSp('usp_Workflow_Create', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: projectId },
      { name: 'Name',      type: sql.NVarChar(100),    value: name },
      { name: 'Template',  type: sql.NVarChar(20),     value: template },
    ]);
    return {
      workflow:    (sets[0] ?? [])[0] as WorkflowRow,
      statuses:    (sets[1] ?? []) as WorkflowStatusRow[],
      transitions: (sets[2] ?? []) as WorkflowTransitionRow[],
    };
  }

  async getByProject(projectId: string) {
    const sets = await execSp('usp_Workflow_GetByProject', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: projectId },
    ]);
    const workflow    = (sets[0] ?? [])[0] as WorkflowRow | undefined;
    const statuses    = (sets[1] ?? []) as WorkflowStatusRow[];
    const transitions = (sets[2] ?? []) as WorkflowTransitionRow[];
    return { workflow, statuses, transitions };
  }

  async addStatus(workflowId: string, name: string, category: string, color: string) {
    const rows = await execSpOne<WorkflowStatusRow>('usp_Workflow_AddStatus', [
      { name: 'WorkflowId', type: sql.UniqueIdentifier, value: workflowId },
      { name: 'Name',       type: sql.NVarChar(100),    value: name },
      { name: 'Category',   type: sql.NVarChar(20),     value: category },
      { name: 'Color',      type: sql.NVarChar(20),     value: color },
    ]);
    return rows[0];
  }

  async updateStatus(
    statusId: string,
    name?: string | null,
    category?: string | null,
    color?: string | null,
    position?: number | null,
  ) {
    const rows = await execSpOne<WorkflowStatusRow>('usp_Workflow_UpdateStatus', [
      { name: 'StatusId', type: sql.UniqueIdentifier, value: statusId },
      { name: 'Name',     type: sql.NVarChar(100),    value: name     ?? null },
      { name: 'Category', type: sql.NVarChar(20),     value: category ?? null },
      { name: 'Color',    type: sql.NVarChar(20),     value: color    ?? null },
      { name: 'Position', type: sql.Int,              value: position ?? null },
    ]);
    return rows[0];
  }

  async deleteStatus(statusId: string): Promise<void> {
    await execSpOne('usp_Workflow_DeleteStatus', [
      { name: 'StatusId', type: sql.UniqueIdentifier, value: statusId },
    ]);
  }

  async addTransition(workflowId: string, fromStatus: string, toStatus: string, name?: string) {
    const rows = await execSpOne<WorkflowTransitionRow>('usp_Workflow_AddTransition', [
      { name: 'WorkflowId', type: sql.UniqueIdentifier, value: workflowId },
      { name: 'FromStatus', type: sql.NVarChar(100),    value: fromStatus },
      { name: 'ToStatus',   type: sql.NVarChar(100),    value: toStatus },
      { name: 'Name',       type: sql.NVarChar(100),    value: name ?? null },
    ]);
    return rows[0];
  }

  async removeTransition(workflowId: string, fromStatus: string, toStatus: string): Promise<void> {
    await execSpOne('usp_Workflow_RemoveTransition', [
      { name: 'WorkflowId', type: sql.UniqueIdentifier, value: workflowId },
      { name: 'FromStatus', type: sql.NVarChar(100),    value: fromStatus },
      { name: 'ToStatus',   type: sql.NVarChar(100),    value: toStatus },
    ]);
  }

  async getWorkspaceId(workflowId: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Workflow_GetWorkspaceId', [
      { name: 'WorkflowId', type: sql.UniqueIdentifier, value: workflowId },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async getWorkspaceIdByStatus(statusId: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_WorkflowStatus_GetWorkspaceId', [
      { name: 'StatusId', type: sql.UniqueIdentifier, value: statusId },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }
}
