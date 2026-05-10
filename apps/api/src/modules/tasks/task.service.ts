import { TaskRepository } from './task.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { webhookOutgoingService } from '../webhooks/webhook-outgoing.service.js';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilters } from '@projectflow/types';

export class TaskService {
  constructor(private repo: TaskRepository) {}

  async createTask(input: CreateTaskInput, actorId: string): Promise<Task> {
    const task = await this.repo.create(input);

    // Notify assignees (if provided at creation)
    if ((input as any).assigneeId) {
      notificationService.notify({
        recipientIds: [(input as any).assigneeId],
        actorId,
        type: 'TASK_ASSIGNED',
        payload: { taskId: task.id, taskTitle: task.title },
      }).catch((err: any) => console.error('[taskService] notification failed:', err?.message));
    }

    // Dispatch outgoing webhooks (fire-and-forget)
    webhookOutgoingService.dispatch(task.workspaceId, 'issue.created', {
      id: task.id, issueKey: task.issueKey, title: task.title,
      type: task.type, status: task.status, priority: task.priority,
      projectId: task.projectId,
    }).catch((err: any) => console.error('[taskService] webhook dispatch failed:', err?.message));

    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.repo.getById(taskId);
  }

  async listTasks(filters: TaskFilters): Promise<{ tasks: Task[]; total: number }> {
    return this.repo.list(filters);
  }

  async transitionTask(taskId: string, newStatus: string, actorId: string): Promise<Task> {
    const task = await this.repo.transition(taskId, newStatus, actorId);
    webhookOutgoingService.dispatch(task.workspaceId, 'issue.updated', {
      id: task.id, issueKey: task.issueKey, title: task.title,
      status: newStatus, projectId: task.projectId,
    }).catch((err: any) => console.error('[taskService] webhook dispatch failed:', err?.message));;
    return task;
  }

  async deleteTask(taskId: string, actorId: string): Promise<Task> {
    const task = await this.repo.delete(taskId, actorId);
    webhookOutgoingService.dispatch(task.workspaceId, 'issue.deleted', {
      id: task.id, issueKey: task.issueKey, projectId: task.projectId,
    }).catch((err: any) => console.error('[taskService] webhook dispatch failed:', err?.message));
    return task;
  }

  async updateTask(taskId: string, input: UpdateTaskInput, actorId: string): Promise<Task | null> {
    return this.repo.update(taskId, input, actorId);
  }
}
