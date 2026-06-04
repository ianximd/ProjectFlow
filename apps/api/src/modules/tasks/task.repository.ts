import sql from 'mssql';
import { execSpOne, execSp } from '../../shared/lib/sqlClient.js';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilters } from '@projectflow/types';

export interface AssigneeRow {
  TaskId:    string;
  UserId:    string;
  Email:     string;
  Name:      string;
  AvatarUrl: string | null;
}

export class TaskRepository {

  /**
   * Phase 2: whether the task's Space allows multiple assignees. Fails CLOSED —
   * if the task (or its space) can't be resolved, returns false so the
   * multi-assignee gate blocks rather than silently allowing the write on a
   * non-existent task.
   */
  async getSpaceMultipleAssignees(taskId: string): Promise<boolean> {
    const rows = await execSpOne<{ MultipleAssignees: boolean }>('usp_Space_GetMultipleAssignees',
      [{ name: 'TaskId', type: sql.UniqueIdentifier, value: taskId }]);
    if (!rows[0]) return false;
    return !!rows[0].MultipleAssignees;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const rows = await execSpOne<Task>('usp_Task_Create', [
      { name: 'ProjectId',   type: sql.UniqueIdentifier, value: input.projectId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: input.workspaceId },
      { name: 'Title',       type: sql.NVarChar(500),    value: input.title },
      { name: 'Description', type: sql.NVarChar(sql.MAX),value: input.description ?? null },
      { name: 'Type',        type: sql.NVarChar(20),     value: input.type ?? 'TASK' },
      { name: 'Status',      type: sql.NVarChar(100),    value: (input as any).status ?? 'To Do' },
      { name: 'Priority',    type: sql.NVarChar(20),     value: input.priority ?? 'MEDIUM' },
      { name: 'ReporterId',  type: sql.UniqueIdentifier, value: input.reporterId },
      { name: 'SprintId',    type: sql.UniqueIdentifier, value: input.sprintId ?? null },
      { name: 'StoryPoints', type: sql.Float,            value: input.storyPoints ?? null },
      // DATETIME2 now (migration 0024) so the API can pass a full ISO timestamp
      // and store hour/minute precision for the deadline.
      { name: 'DueDate',     type: sql.DateTime2,        value: input.dueDate ?? null },
      // Hierarchy (0029): re-home into a List + optional subtask parent.
      { name: 'ListId',       type: sql.UniqueIdentifier, value: (input as any).listId ?? null },
      { name: 'ParentTaskId', type: sql.UniqueIdentifier, value: (input as any).parentTaskId ?? null },
    ]);
    return rows[0];
  }

  async move(taskId: string, listId: string, position: number): Promise<Task | null> {
    const rows = await execSpOne<Task>('usp_Task_Move', [
      { name: 'TaskId',   type: sql.UniqueIdentifier, value: taskId },
      { name: 'ListId',   type: sql.UniqueIdentifier, value: listId },
      { name: 'Position', type: sql.Float,            value: position },
    ]);
    return rows[0] ?? null;
  }

  async getById(taskId: string): Promise<Task | null> {
    const rows = await execSpOne<Task>('usp_Task_GetById', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows[0] ?? null;
  }

  async getWorkspaceId(taskId: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Task_GetWorkspaceId', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async list(
    filters: TaskFilters,
  ): Promise<{
    tasks: Task[];
    total: number;
    assigneesByTaskId: Record<string, AssigneeRow[]>;
  }> {
    const sets = await execSp('usp_Task_List', [
      { name: 'ProjectId',  type: sql.UniqueIdentifier, value: filters.projectId },
      { name: 'Status',     type: sql.NVarChar(100),    value: filters.status ?? null },
      { name: 'AssigneeId', type: sql.UniqueIdentifier, value: filters.assigneeId ?? null },
      { name: 'SprintId',   type: sql.UniqueIdentifier, value: filters.sprintId ?? null },
      { name: 'Priority',   type: sql.NVarChar(20),     value: filters.priority ?? null },
      { name: 'Page',       type: sql.Int,              value: filters.page ?? 1 },
      { name: 'PageSize',   type: sql.Int,              value: filters.pageSize ?? 25 },
    ]);

    // Group result-set 3 (assignees) by TaskId so the API can return a single
    // map-keyed payload — saves the client from having to do the bucketing.
    const assigneesByTaskId: Record<string, AssigneeRow[]> = {};
    for (const row of (sets[2] ?? []) as AssigneeRow[]) {
      const list = assigneesByTaskId[row.TaskId] ?? (assigneesByTaskId[row.TaskId] = []);
      list.push(row);
    }

    return {
      tasks: sets[0] as Task[],
      total: (sets[1]?.[0] as any)?.Total ?? 0,
      assigneesByTaskId,
    };
  }

  async setAssignees(taskId: string, userIds: string[]): Promise<AssigneeRow[]> {
    const rows = await execSpOne<AssigneeRow>('usp_Task_SetAssignees', [
      { name: 'TaskId',  type: sql.UniqueIdentifier,  value: taskId },
      { name: 'UserIds', type: sql.NVarChar(sql.MAX), value: userIds.join(',') },
    ]);
    return Array.from(rows);
  }

  async setPosition(
    taskId: string,
    position: number,
    newStatus: string | null,
  ): Promise<Task | null> {
    const rows = await execSpOne<Task>('usp_Task_UpdatePosition', [
      { name: 'TaskId',    type: sql.UniqueIdentifier, value: taskId },
      { name: 'Position',  type: sql.Float,            value: position },
      { name: 'NewStatus', type: sql.NVarChar(100),    value: newStatus ?? null },
    ]);
    return rows[0] ?? null;
  }

  async transition(taskId: string, newStatus: string, actorId: string): Promise<Task> {
    const rows = await execSpOne<Task>('usp_Task_Transition', [
      { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
      { name: 'NewStatus',   type: sql.NVarChar(100),    value: newStatus },
      { name: 'RequesterId', type: sql.UniqueIdentifier, value: actorId },
    ]);
    return rows[0];
  }

  async delete(taskId: string, actorId: string): Promise<Task> {
    const rows = await execSpOne<Task>('usp_Task_Delete', [
      { name: 'Id',      type: sql.UniqueIdentifier, value: taskId },
      { name: 'ActorId', type: sql.UniqueIdentifier, value: actorId },
    ]);
    return rows[0];
  }

  // _actorId is threaded through for future SP-level auditing; HTTP-layer
  // actor capture is already handled by auditMiddleware on /tasks/*.
  async update(taskId: string, input: UpdateTaskInput, _actorId?: string): Promise<Task | null> {
    const rows = await execSpOne<Task>('usp_Task_Update', [
      { name: 'TaskId',      type: sql.UniqueIdentifier,  value: taskId },
      { name: 'Title',       type: sql.NVarChar(500),     value: input.title ?? null },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: input.description ?? null },
      { name: 'Type',        type: sql.NVarChar(20),      value: input.type ?? null },
      { name: 'Priority',    type: sql.NVarChar(20),      value: input.priority ?? null },
      { name: 'SprintId',    type: sql.UniqueIdentifier,  value: input.sprintId ?? null },
      { name: 'EpicId',      type: sql.UniqueIdentifier,  value: input.epicId ?? null },
      { name: 'StoryPoints', type: sql.Float,             value: input.storyPoints ?? null },
      // DATETIME2 since migration 0024 — keeps time precision when the
      // drawer's datetime-local input PATCHes a new deadline.
      { name: 'DueDate',     type: sql.DateTime2,         value: input.dueDate ?? null },
    ]);
    return rows[0] ?? null;
  }
}
