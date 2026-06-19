import { TaskRepository, type AssigneeRow } from './task.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { fanOutTaskEvent, debounceGate, taskUpdatedDebounceKey } from '../notifications/fanout.js';
import { watcherService } from '../watchers/watcher.service.js';
import { webhookOutgoingService } from '../webhooks/webhook-outgoing.service.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { dependencyService, computeDateDelta } from '../dependencies/dependency.service.js';
import { recurrenceService } from '../recurrence/recurrence.service.js';
import { goalService } from '../goals/goal.service.js';
import { appService } from '../apps/app.service.js';
import { publishTaskEvent } from '../../graphql/task-events.js';
import { emitAutomationEvent } from '../automation/automation.bus.js';
import { aiIndexService } from '../ai/index/ai-index.service.js';
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

    void emitAutomationEvent({
      type: 'TASK_CREATED',
      workspaceId: (task as any).workspaceId ?? (task as any).WorkspaceId,
      projectId: (task as any).projectId ?? (task as any).ProjectId,
      taskId: task.id,
      actorId,
      reporterId: (task as any).reporterId ?? (task as any).ReporterId ?? null,
    });

    // AI index (Phase 11a): keep AiChunks in sync. Fire-and-forget; the service
    // fails open so a Redis/queue outage never faults the create.
    void aiIndexService.enqueueIndex(
      (task as any).workspaceId ?? (task as any).WorkspaceId, 'task', task.id,
    ).catch((err: any) => log.error({ err: err?.message }, 'ai-index enqueue failed'));

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

  async transitionTask(taskId: string, newStatus: string, actorId: string, opts?: { ignoreDependencyWarning?: boolean }): Promise<Task> {
    // Block DONE-category transitions while required custom fields are unfilled.
    await customFieldService.assertRequiredMetForStatus(taskId, newStatus); // throws RequiredFieldsUnmetError
    // Dependency Warning: refuse to close a task that still has open blockers.
    // The SP only returns rows when blockers are open, so the guard is safe
    // even if the done-group gate is slightly too broad.
    // Dependency Warning (Phase 10a): the route suppresses this when the
    // dependency_warning app is OFF for the task's scope (passes ignoreDependencyWarning).
    if (isDoneGroupStatus(newStatus) && !opts?.ignoreDependencyWarning) {
      await dependencyService.assertNoOpenBlockers(taskId); // throws DependencyWarningError
    }
    // Capture the status BEFORE the transition so recurrence only fires on a true
    // crossing INTO the done-group from a non-done status (see spawn guard below).
    const beforeTransition = await this.repo.getById(taskId);
    const previousStatus = (beforeTransition as any)?.status ?? (beforeTransition as any)?.Status ?? null;
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
    //
    // Idempotency: only spawn when the task CROSSES INTO the done-group from a
    // NON-done status. Done→Done or Done→Resolved (both done-group) must NOT
    // re-spawn — without this gate, re-confirming/moving between done statuses
    // would mint a duplicate occurrence each time.
    if (isDoneGroupStatus(newStatus) && !isDoneGroupStatus(previousStatus ?? '')) {
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

    // Goals (Phase 8e): a task transition can change a task-linked target's
    // completed/total — recompute any target that counts this task. BEST-EFFORT,
    // fire-and-forget AFTER the transition committed; recomputeForTask swallows
    // its own errors, but guard the dispatch too so nothing faults the transition.
    void goalService.recomputeForTask(taskId).catch((err: any) =>
      log.error({ err: err?.message, taskId }, 'goal recompute-on-transition failed'));

    void emitAutomationEvent({
      type: 'STATUS_CHANGED',
      workspaceId: (task as any).workspaceId ?? (task as any).WorkspaceId,
      projectId: (task as any).projectId ?? (task as any).ProjectId,
      taskId,
      actorId,
      reporterId: (task as any).reporterId ?? (task as any).ReporterId ?? null,
      fromStatus: previousStatus,
      toStatus: newStatus,
    });

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

    // AI index (Phase 11a): tombstone the task's chunks. Fire-and-forget.
    void aiIndexService.enqueueDelete(
      (task as any).workspaceId ?? (task as any).WorkspaceId, 'task', task.id,
    ).catch((err: any) => log.error({ err: err?.message }, 'ai-index enqueue failed'));

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
        // Reschedule Dependencies (Phase 10a): only cascade when the app is ON for
        // the task's scope. The base date update always proceeds; only the cascade
        // is gated. (Default-on, so unchanged behavior unless an override turns it off.)
        const scope = await appService.scopeNodeForTask(taskId);
        if (scope && await appService.isEnabled('reschedule_dependencies', scope)) {
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

      const projectId = projectIdOf(task);
      const workspaceId = (task as any).workspaceId ?? (task as any).WorkspaceId ?? null;
      if (projectId && workspaceId) {
        if ('assigneeId' in (input as any)) {
          void emitAutomationEvent({
            type: 'ASSIGNEE_CHANGED', workspaceId, projectId, taskId, actorId,
            from: null, to: (input as any).assigneeId ?? null,
          });
        }
        for (const field of ['priority', 'type', 'dueDate', 'title', 'storyPoints'] as const) {
          if (field in (input as any) && (input as any)[field] !== undefined) {
            void emitAutomationEvent({
              type: 'FIELD_CHANGED', workspaceId, projectId, taskId, actorId,
              field, from: null, to: (input as any)[field],
            });
          }
        }
      }

      // AI index (Phase 11a): an update may change Title/Description — re-index.
      // Fire-and-forget; the service fails open.
      void aiIndexService.enqueueIndex(
        (task as any).workspaceId ?? (task as any).WorkspaceId, 'task', taskId,
      ).catch((err: any) => log.error({ err: err?.message }, 'ai-index enqueue failed'));
    }
    return task;
  }
}
