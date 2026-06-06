import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { TaskDependencyRef } from '@projectflow/types';

// SPs return PascalCase columns; the TaskDependencyRef contract is camelCase.
// Map at the repository boundary so callers (REST, GraphQL, services) get the
// declared shape.
function toDepRef(row: any): TaskDependencyRef {
  return {
    taskId:   row.TaskId,
    title:    row.Title,
    status:   row.Status,
    issueKey: row.IssueKey ?? null,
  };
}

export class DependencyRepository {
  /** EXEC usp_TaskDependency_Add — returns the inserted/existing edge row. */
  async add(taskId: string, dependsOn: string, workspaceId: string): Promise<any> {
    const rows = await execSpOne<any>('usp_TaskDependency_Add', [
      { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
      { name: 'DependsOn',   type: sql.UniqueIdentifier, value: dependsOn },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rows[0] ?? null;
  }

  /** usp_TaskDependency_Remove — returns the number of edges removed. */
  async remove(taskId: string, dependsOn: string): Promise<number> {
    const rows = await execSpOne<{ Removed: number }>('usp_TaskDependency_Remove', [
      { name: 'TaskId',    type: sql.UniqueIdentifier, value: taskId },
      { name: 'DependsOn', type: sql.UniqueIdentifier, value: dependsOn },
    ]);
    return rows[0]?.Removed ?? 0;
  }

  /**
   * usp_TaskDependency_ListForTask — TWO recordsets:
   *   [0] waitingOn — tasks this task depends on
   *   [1] blocking  — tasks that depend on this task
   */
  async listForTask(taskId: string): Promise<{ waitingOn: TaskDependencyRef[]; blocking: TaskDependencyRef[] }> {
    const sets = await execSp<any>('usp_TaskDependency_ListForTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return {
      waitingOn: (sets[0] ?? []).map(toDepRef),
      blocking:  (sets[1] ?? []).map(toDepRef),
    };
  }

  /** usp_Task_HasOpenBlockers — rows are returned only for blockers NOT in a DONE group. */
  async openBlockers(taskId: string): Promise<{ taskId: string; title: string; status: string }[]> {
    const rows = await execSpOne<any>('usp_Task_HasOpenBlockers', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows.map((r: any) => ({ taskId: r.TaskId, title: r.Title, status: r.Status }));
  }

  /**
   * usp_TaskDependency_RescheduleDependents — shifts dependents' dates by
   * @DeltaDays whole days (Tasks.StartDate/DueDate are SQL DATE columns).
   * Returns the ids of the shifted dependents.
   */
  async rescheduleDependents(taskId: string, deltaDays: number): Promise<string[]> {
    const rows = await execSpOne<{ TaskId: string }>('usp_TaskDependency_RescheduleDependents', [
      { name: 'TaskId',    type: sql.UniqueIdentifier, value: taskId },
      { name: 'DeltaDays', type: sql.Int,              value: deltaDays },
    ]);
    return rows.map((r) => r.TaskId);
  }
}
