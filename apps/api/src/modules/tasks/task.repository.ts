import sql from 'mssql';
import { execSpOne, execSp } from '../../shared/lib/sqlClient.js';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilters } from '@projectflow/types';

export class TaskRepository {

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
      { name: 'DueDate',     type: sql.Date,             value: input.dueDate ?? null },
    ]);
    return rows[0];
  }

  async getById(taskId: string): Promise<Task | null> {
    const rows = await execSpOne<Task>('usp_Task_GetById', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows[0] ?? null;
  }

  async list(filters: TaskFilters): Promise<{ tasks: Task[]; total: number }> {
    const sets = await execSp('usp_Task_List', [
      { name: 'ProjectId',  type: sql.UniqueIdentifier, value: filters.projectId },
      { name: 'Status',     type: sql.NVarChar(100),    value: filters.status ?? null },
      { name: 'AssigneeId', type: sql.UniqueIdentifier, value: filters.assigneeId ?? null },
      { name: 'SprintId',   type: sql.UniqueIdentifier, value: filters.sprintId ?? null },
      { name: 'Priority',   type: sql.NVarChar(20),     value: filters.priority ?? null },
      { name: 'Page',       type: sql.Int,              value: filters.page ?? 1 },
      { name: 'PageSize',   type: sql.Int,              value: filters.pageSize ?? 25 },
    ]);
    return { tasks: sets[0] as Task[], total: (sets[1]?.[0] as any)?.Total ?? 0 };
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
      { name: 'DueDate',     type: sql.Date,              value: input.dueDate ?? null },
    ]);
    return rows[0] ?? null;
  }
}
