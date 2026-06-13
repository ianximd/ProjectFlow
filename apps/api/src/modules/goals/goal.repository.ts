import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { GoalFolder, Goal, Target, GoalScopeType, GoalStatus, TargetKind } from '@projectflow/types';

/** Map a GoalFolders SP row (PascalCase, SELECT *) → camelCase contract. */
export function mapFolderRow(r: any): GoalFolder {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, name: r.Name, ownerId: r.OwnerId,
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

/** Map a Goals SP row → camelCase contract. */
export function mapGoalRow(r: any): Goal {
  return {
    id: r.Id, workspaceId: r.WorkspaceId,
    scopeType: r.ScopeType as GoalScopeType, scopeId: r.ScopeId ?? null,
    folderId: r.FolderId ?? null, name: r.Name, description: r.Description ?? null,
    ownerId: r.OwnerId, dueDate: r.DueDate ? new Date(r.DueDate).toISOString().split('T')[0] : null,
    status: r.Status as GoalStatus,
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

/** Map a Targets SP row → camelCase contract. */
export function mapTargetRow(r: any): Target {
  return {
    id: r.Id, goalId: r.GoalId, kind: r.Kind as TargetKind, name: r.Name,
    unit: r.Unit ?? null, currencyCode: r.CurrencyCode ?? null,
    startValue: r.StartValue ?? null, targetValue: r.TargetValue ?? null,
    currentValue: r.CurrentValue ?? null,
    taskFilter: r.TaskFilter ?? null, position: Number(r.Position ?? 0),
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

export class GoalRepository {
  // ── Folders ──
  async createFolder(p: { workspaceId: string; name: string; ownerId: string }): Promise<GoalFolder> {
    const rows = await execSpOne('usp_GoalFolder_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'Name', type: sql.NVarChar(200), value: p.name },
      { name: 'OwnerId', type: sql.UniqueIdentifier, value: p.ownerId },
    ]);
    return mapFolderRow(rows[0]);
  }
  async listFolders(workspaceId: string): Promise<GoalFolder[]> {
    const rows = await execSpOne('usp_GoalFolder_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as any[]).map(mapFolderRow);
  }
  async deleteFolder(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_GoalFolder_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }

  // ── Goals ──
  async createGoal(p: {
    workspaceId: string; scopeType: GoalScopeType; scopeId: string | null;
    folderId: string | null; name: string; description: string | null;
    ownerId: string; dueDate: string | null;
  }): Promise<Goal> {
    const rows = await execSpOne('usp_Goal_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ScopeType', type: sql.NVarChar(12), value: p.scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: p.scopeId },
      { name: 'FolderId', type: sql.UniqueIdentifier, value: p.folderId },
      { name: 'Name', type: sql.NVarChar(300), value: p.name },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description },
      { name: 'OwnerId', type: sql.UniqueIdentifier, value: p.ownerId },
      { name: 'DueDate', type: sql.Date, value: p.dueDate ? new Date(p.dueDate) : null },
    ]);
    return mapGoalRow(rows[0]);
  }
  async updateGoal(id: string, p: {
    name?: string | null; description?: string | null; dueDate?: string | null;
    status?: GoalStatus | null; folderId?: string | null;
  }): Promise<Goal | null> {
    const rows = await execSpOne('usp_Goal_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(300), value: p.name ?? null },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description ?? null },
      { name: 'DueDate', type: sql.Date, value: p.dueDate ? new Date(p.dueDate) : null },
      { name: 'Status', type: sql.NVarChar(12), value: p.status ?? null },
      { name: 'FolderId', type: sql.UniqueIdentifier, value: p.folderId ?? null },
    ]);
    return rows[0] ? mapGoalRow(rows[0]) : null;
  }
  async deleteGoal(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_Goal_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }
  async getGoal(id: string): Promise<Goal | null> {
    const rows = await execSpOne('usp_Goal_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapGoalRow(rows[0]) : null;
  }
  async listGoals(workspaceId: string, folderId: string | null): Promise<Goal[]> {
    const rows = await execSpOne('usp_Goal_ListByWorkspace', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'FolderId', type: sql.UniqueIdentifier, value: folderId },
    ]);
    return (rows as any[]).map(mapGoalRow);
  }
  async getGoalWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Goal_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }
  /** Resolve a folder's workspace (for RBAC on folder delete — never trust a param). */
  async getFolderWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_GoalFolder_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  // ── Targets ──
  async createTarget(p: {
    goalId: string; kind: TargetKind; name: string; unit: string | null;
    currencyCode: string | null; startValue: number | null; targetValue: number | null;
    currentValue: number | null; taskFilter: string | null;
  }): Promise<Target> {
    const rows = await execSpOne('usp_Target_Create', [
      { name: 'GoalId', type: sql.UniqueIdentifier, value: p.goalId },
      { name: 'Kind', type: sql.NVarChar(10), value: p.kind },
      { name: 'Name', type: sql.NVarChar(300), value: p.name },
      { name: 'Unit', type: sql.NVarChar(20), value: p.unit },
      { name: 'CurrencyCode', type: sql.Char(3), value: p.currencyCode },
      { name: 'StartValue', type: sql.Float, value: p.startValue },
      { name: 'TargetValue', type: sql.Float, value: p.targetValue },
      { name: 'CurrentValue', type: sql.Float, value: p.currentValue },
      { name: 'TaskFilter', type: sql.NVarChar(sql.MAX), value: p.taskFilter },
    ]);
    return mapTargetRow(rows[0]);
  }
  async updateTarget(id: string, p: {
    name?: string | null; unit?: string | null; currencyCode?: string | null;
    startValue?: number | null; targetValue?: number | null; currentValue?: number | null;
    taskFilter?: string | null;
  }): Promise<Target | null> {
    const rows = await execSpOne('usp_Target_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(300), value: p.name ?? null },
      { name: 'Unit', type: sql.NVarChar(20), value: p.unit ?? null },
      { name: 'CurrencyCode', type: sql.Char(3), value: p.currencyCode ?? null },
      { name: 'StartValue', type: sql.Float, value: p.startValue ?? null },
      { name: 'TargetValue', type: sql.Float, value: p.targetValue ?? null },
      { name: 'CurrentValue', type: sql.Float, value: p.currentValue ?? null },
      { name: 'TaskFilter', type: sql.NVarChar(sql.MAX), value: p.taskFilter ?? null },
    ]);
    return rows[0] ? mapTargetRow(rows[0]) : null;
  }
  async deleteTarget(id: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_Target_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.Deleted ?? 0;
  }
  async listTargets(goalId: string): Promise<Target[]> {
    const rows = await execSpOne('usp_Target_ListByGoal', [
      { name: 'GoalId', type: sql.UniqueIdentifier, value: goalId },
    ]);
    return (rows as any[]).map(mapTargetRow);
  }
  async recomputeTaskValue(targetId: string): Promise<Target | null> {
    const rows = await execSpOne('usp_Target_RecomputeTaskValue', [
      { name: 'TargetId', type: sql.UniqueIdentifier, value: targetId },
    ]);
    return rows[0] ? mapTargetRow(rows[0]) : null;
  }
  async listTaskTargetsForTask(taskId: string): Promise<Array<{ id: string; goalId: string }>> {
    const rows = await execSpOne<{ Id: string; GoalId: string }>('usp_Target_ListTaskTargetsForTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return (rows as any[]).map((r) => ({ id: r.Id, goalId: r.GoalId }));
  }
  /** Resolve a target's workspace via its goal (for RBAC on target update/delete —
   * the SP acts on targetId, so authorize the target's REAL workspace, not the URL goalId). */
  async getTargetWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Target_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }
}

export const goalRepository = new GoalRepository();
