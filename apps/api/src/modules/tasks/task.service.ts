import { TaskRepository, type AssigneeRow } from './task.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { fanOutTaskEvent, debounceGate, taskUpdatedDebounceKey } from '../notifications/fanout.js';
import { watcherService } from '../watchers/watcher.service.js';
import { webhookOutgoingService } from '../webhooks/webhook-outgoing.service.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { dependencyService, computeDateDelta } from '../dependencies/dependency.service.js';
import { recurrenceService } from '../recurrence/recurrence.service.js';
import { publishTaskEvent } from '../../graphql/task-events.js';
import { MultipleAssigneesDisabledError } from './task.errors.js';
import { subLogger } from '../../shared/lib/logger.js';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilters } from '@projectflow/types';

const log = subLogger('tasks');

// Status names that count as a DONE-group target when no workflow lookup is
// cheaply available — mirrors the fallback in usp_Task_HasOpenBlockers.
const DONE_GROUP_STATUSES = new Set(['Done', 'Resolved', 'Closed', 'Completed']);
function isDoneGroupStatus(status: string): boolean {
  return DONE_GROUP_STATUSES.has(status);
}

function projectIdOf(task: unknown): string | null {
  const t = task as any;
  return t?.projectId ?? t?.ProjectId ?? null;
}

/** Parent-task id, casing-tolerant: task SPs return PascalCase (SELECT *) in
 *  some paths and camelCase in others. */
function parentIdOf(task: unknown): string | null {
  const t = task as any;
  return t?.parentTaskId ?? t?.ParentTaskId ?? null;
}

export class TaskService {
  constructor(private repo: TaskRepository) {}

  async createTask(input: CreateTaskInput, actorId: string): Promise<Task> {
    const task = await this.repo.create(input);

    // A new subtask changes its parent's subtask count — recompute progress_auto.
    const parentId = parentIdOf(task);
    if (parentId) customFieldService.recomputeProgressAuto(parentId).catch(() => {});

    // Notify assignees (if provided at creation)
    if ((input as any).assigneeId) {
      notificationService.notify({
        recipientIds: [(input as any).assigneeId],
        actorId,
        type: 'TASK_ASSIGNED',
        payload: { taskId: task.id, taskTitle: task.title },
      }).catch((err: any) => log.error({ err: err?.message }, 'notification failed'));
    }

    // Dispatch outgoing webhooks (fire-and-forget)
    webhookOutgoingService.dispatch(task.workspaceId, 'issue.created', {
      id: task.id, issueKey: task.issueKey, title: task.title,
      type: task.type, status: task.status, priority: task.priority,
      projectId: task.projectId,
    }).catch((err: any) => log.error({ err: err?.message }, 'webhook dispatch failed'));

    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.repo.getById(taskId);
  }

  async listTasks(filters: TaskFilters): Promise<{
    tasks: Task[];
    total: number;
    assigneesByTaskId: Record<string, AssigneeRow[]>;
  }> {
    return this.repo.list(filters);
  }

  async setAssignees(taskId: string, userIds: string[], actorId: string): Promise<AssigneeRow[]> {
    if (userIds.length > 1) {
      const allowed = await this.repo.getSpaceMultipleAssignees(taskId);
      if (!allowed) throw new MultipleAssigneesDisabledError();
    }
    const before = await this.repo.getById(taskId);
    const rows = await this.repo.setAssignees(taskId, userIds);

    // Notify newcomers (anyone not previously assigned). Cheap because the
    // assignee count is tiny — we don't bother diffing with a Set.
    if (rows.length && before) {
      notificationService.notify({
        recipientIds: rows.map((r) => r.UserId).filter((id) => id !== actorId),
        actorId,
        type: 'TASK_ASSIGNED',
        payload: { taskId, taskTitle: before.title },
      }).catch((err: any) => log.error({ err: err?.message }, 'notification failed'));

      webhookOutgoingService.dispatch(before.workspaceId, 'issue.assigned', {
        id: before.id, issueKey: before.issueKey, title: before.title,
        assigneeIds: rows.map((r) => r.UserId), projectId: before.projectId,
      }).catch((err: any) => log.error({ err: err?.message }, 'webhook dispatch failed'));

      // New assignees auto-watch the task.
      for (const r of rows) void watcherService.add(taskId, r.UserId).catch(() => {});

      if (await debounceGate(taskUpdatedDebounceKey(taskId, 'assignees'), 60)) {
        void fanOutTaskEvent(taskId, actorId, 'TASK_UPDATED', {
          taskId, taskTitle: (before as any).title ?? (before as any).Title ?? '',
          change: 'assignees',
        });
      }
    }
    return rows;
  }

  async setPosition(taskId: string, position: number, newStatus: string | null): Promise<Task | null> {
    return this.repo.setPosition(taskId, position, newStatus);
  }

  /** Re-home a task into a List (hierarchy Phase 1). Bridges ProjectId to the List's Space. */
  async moveTask(taskId: string, listId: string, position: number): Promise<Task | null> {
    const task = await this.repo.move(taskId, listId, position);
    if (task) {
      webhookOutgoingService.dispatch(task.workspaceId, 'issue.updated', {
        id: task.id, issueKey: task.issueKey, title: task.title,
        status: task.status, projectId: task.projectId,
      }).catch((err: any) => log.error({ err: err?.message }, 'webhook dispatch failed'));
    }
    return task;
  }

  async transitionTask(taskId: string, newStatus: string, actorId: string): Promise<Task> {
    // Block DONE-category transitions while required custom fields are unfilled.
    await customFieldService.assertRequiredMetForStatus(taskId, newStatus); // throws RequiredFieldsUnmetError
    // Dependency Warning: refuse to close a task that still has open blockers.
    // The SP only returns rows when blockers are open, so the guard is safe
    // even if the done-group gate is slightly too broad.
    if (isDoneGroupStatus(newStatus)) {
      await dependencyService.assertNoOpenBlockers(taskId); // throws DependencyWarningError
    }
    const task = await this.repo.transition(taskId, newStatus, actorId);
    // A transition may flip this task's resolved state — recompute the PARENT's progress_auto.
    const parentId = parentIdOf(task);
    if (parentId) customFieldService.recomputeProgressAuto(parentId).catch(() => {});
    webhookOutgoingService.dispatch(task.workspaceId, 'issue.updated', {
      id: task.id, issueKey: task.issueKey, title: task.title,
      status: newStatus, projectId: task.projectId,
    }).catch((err: any) => log.error({ err: err?.message }, 'webhook dispatch failed'));;

    // Notify watchers of a meaningful status change (debounced to avoid spam).
    if (await debounceGate(taskUpdatedDebounceKey(taskId, 'status'), 60)) {
      void fanOutTaskEvent(taskId, actorId, 'TASK_UPDATED', {
        taskId, taskTitle: (task as any).title ?? (task as any).Title ?? '',
        change: 'status', status: newStatus,
      });
    }

    // Recurring tasks (Phase 5c): on a successful DONE-group transition, spawn the
    // next occurrence if an active recurrence covers on_complete. Fire-and-forget
    // AFTER the transition has committed — a spawn error is logged but never
    // faults the transition the user asked for.
    if (isDoneGroupStatus(newStatus)) {
      void (async () => {
        try {
          const rec = await recurrenceService.getForTask(taskId);
          if (rec && rec.active && (rec.regenerateMode === 'on_complete' || rec.regenerateMode === 'both')) {
            await recurrenceService.spawnNext(rec);
          }
        } catch (err: any) {
          log.error({ err: err?.message, taskId }, 'recurrence spawn-on-complete failed');
        }
      })();
    }

    return task;
  }

  async deleteTask(taskId: string, actorId: string): Promise<Task> {
    const task = await this.repo.delete(taskId, actorId);
    // Removing a subtask changes its parent's subtask count — recompute progress_auto.
    const parentId = parentIdOf(task);
    if (parentId) customFieldService.recomputeProgressAuto(parentId).catch(() => {});
    webhookOutgoingService.dispatch(task.workspaceId, 'issue.deleted', {
      id: task.id, issueKey: task.issueKey, projectId: task.projectId,
    }).catch((err: any) => log.error({ err: err?.message }, 'webhook dispatch failed'));
    return task;
  }

  async updateTask(taskId: string, input: UpdateTaskInput, actorId: string): Promise<Task | null> {
    // Snapshot the schedule dates BEFORE the update so we can detect a date move
    // and cascade-reschedule dependents by the same whole-day delta.
    const before = await this.repo.getDates(taskId);
    const task = await this.repo.update(taskId, input, actorId);
    if (task) {
      const delta = computeDateDelta(before, task as any); // whole days; 0 if no date change
      if (delta !== 0) {
        try {
          const shifted = await dependencyService.rescheduleDependents(taskId, delta);
          const projectId = projectIdOf(task);
          if (projectId) {
            for (const id of shifted) {
              await publishTaskEvent('updated', { projectId, taskId: id });
            }
          }
        } catch (err: any) {
          log.error({ err: err?.message }, 'reschedule dependents failed');
        }
      }
    }
    return task;
  }
}
