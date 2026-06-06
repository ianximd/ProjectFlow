import { RecurrenceRepository } from './recurrence.repository.js';
import {
  computeNextOccurrence,
  validateRule,
  InvalidRecurrenceRuleError,
  type RecurrenceRuleShape,
} from './recurrence.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { watcherService } from '../watchers/watcher.service.js';
import { tagService } from '../tags/tag.service.js';
import { dependencyService } from '../dependencies/dependency.service.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { publishTaskEvent } from '../../graphql/task-events.js';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { subLogger } from '../../shared/lib/logger.js';
import sql from 'mssql';
import type { TaskRecurrence, RecurrenceMode } from '@projectflow/types';

const log = subLogger('recurrence');

export { InvalidRecurrenceRuleError };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VALID_MODES: ReadonlySet<string> = new Set(['on_complete', 'schedule', 'both']);

/** Casing-tolerant readers for SP rows (SELECT * → PascalCase). */
function pick<T = any>(o: any, ...keys: string[]): T | null {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k] as T;
  return null;
}
function asDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class RecurrenceService {
  constructor(
    private repo = new RecurrenceRepository(),
    private taskRepo = new TaskRepository(),
    private listRepo = new ListRepository(),
  ) {}

  getForTask(taskId: string): Promise<TaskRecurrence | null> {
    return this.repo.getForTask(taskId);
  }

  /**
   * Create/replace the recurrence for a task. Validates the rule (throws
   * InvalidRecurrenceRuleError → 422) and seeds the initial NextRunAt from the
   * source task's due date (falling back to now).
   */
  async setForTask(
    taskId: string,
    input: { rule: unknown; regenerateMode: string; includeDependencies?: boolean },
  ): Promise<TaskRecurrence> {
    const rule = validateRule(input.rule);
    if (!VALID_MODES.has(input.regenerateMode)) {
      throw new InvalidRecurrenceRuleError(`regenerateMode must be one of on_complete|schedule|both (got ${input.regenerateMode})`);
    }
    const mode = input.regenerateMode as RecurrenceMode;

    const workspaceId = await this.taskRepo.getWorkspaceId(taskId);
    if (!workspaceId) throw new InvalidRecurrenceRuleError('Task not found');

    const source = await this.taskRepo.getById(taskId);
    const sourceDue = asDate(pick(source, 'dueDate', 'DueDate')) ?? new Date();
    const nextRunAt = computeNextOccurrence(rule, sourceDue);

    return this.repo.setForTask({
      taskId,
      workspaceId,
      ruleJson: JSON.stringify(rule),
      regenerateMode: mode,
      nextRunAt,
      includeDependencies: !!input.includeDependencies,
    });
  }

  async clear(taskId: string): Promise<void> {
    await this.repo.clear(taskId);
  }

  /**
   * Spawn the next occurrence of a recurrence: clone the source task with
   * remapped dates + reset status, copy sub-objects, then advance the schedule.
   * Best-effort sub-object copies (each guarded) — a copy failure logs but does
   * not abort the spawn. Returns the new task id, or null when nothing spawned
   * (rule ended / source missing).
   */
  async spawnNext(recurrence: TaskRecurrence): Promise<string | null> {
    const rule = recurrence.rule as RecurrenceRuleShape;
    const source = await this.taskRepo.getById(recurrence.taskId);
    if (!source) {
      log.warn({ recurrenceId: recurrence.id, taskId: recurrence.taskId }, 'spawnNext: source task missing — deactivating');
      await this.repo.advanceAfterSpawn({ id: recurrence.id, lastSpawnedTaskId: recurrence.taskId, nextRunAt: null, active: false });
      return null;
    }

    const s = source as any;
    const workspaceId = recurrence.workspaceId;

    // ── Remap dates ──────────────────────────────────────────────────────────
    // New due = next occurrence after the source's due (or now). New start
    // preserves the source's start→due duration (in whole days) when both exist.
    const sourceDue = asDate(pick(s, 'dueDate', 'DueDate')) ?? new Date();
    const sourceStart = asDate(pick(s, 'startDate', 'StartDate'));
    const newDue = computeNextOccurrence(rule, sourceDue);
    if (!newDue) {
      // Rule ended (endsAt passed) → nothing to spawn; deactivate.
      await this.repo.advanceAfterSpawn({ id: recurrence.id, lastSpawnedTaskId: recurrence.taskId, nextRunAt: null, active: false });
      return null;
    }
    let newStart: Date | null = null;
    if (sourceStart && asDate(pick(s, 'dueDate', 'DueDate'))) {
      const durationDays = Math.round((sourceDue.getTime() - sourceStart.getTime()) / MS_PER_DAY);
      newStart = new Date(newDue.getTime() - durationDays * MS_PER_DAY);
    }

    // ── Reset status to the list's first effective status (fallback to source) ─
    const listId = pick<string>(s, 'listId', 'ListId');
    let resetStatus = pick<string>(s, 'status', 'Status') ?? 'To Do';
    if (listId) {
      const statuses = await this.listRepo.effectiveStatuses(listId).catch(() => []);
      if (statuses.length) resetStatus = (statuses[0] as any).name ?? (statuses[0] as any).Name ?? resetStatus;
    }

    // ── Clone the core task via usp_Task_Create ───────────────────────────────
    const clone = await this.taskRepo.create({
      projectId:   pick<string>(s, 'projectId', 'ProjectId') ?? undefined,
      workspaceId,
      title:       pick<string>(s, 'title', 'Title') ?? 'Recurring task',
      description: pick<string>(s, 'description', 'Description') ?? null,
      type:        pick<string>(s, 'type', 'Type') ?? 'TASK',
      status:      resetStatus,
      priority:    pick<string>(s, 'priority', 'Priority') ?? 'MEDIUM',
      reporterId:  pick<string>(s, 'reporterId', 'ReporterId')!,
      sprintId:    pick<string>(s, 'sprintId', 'SprintId') ?? null,
      storyPoints: pick<number>(s, 'storyPoints', 'StoryPoints') ?? null,
      dueDate:     newDue.toISOString(),
      listId:      listId ?? null,
    } as any);

    const newTaskId = (clone as any).id ?? (clone as any).Id;
    const newProjectId = (clone as any).projectId ?? (clone as any).ProjectId ?? pick<string>(s, 'projectId', 'ProjectId');

    // Apply the remapped start date (usp_Task_Create only sets DueDate).
    if (newStart) {
      try {
        await execSpOne('usp_Task_UpdateDates', [
          { name: 'TaskId',      type: sql.UniqueIdentifier, value: newTaskId },
          { name: 'RequesterId', type: sql.UniqueIdentifier, value: pick<string>(s, 'reporterId', 'ReporterId') },
          { name: 'StartDate',   type: sql.Date,             value: newStart },
          { name: 'DueDate',     type: sql.DateTime2,        value: newDue },
        ]);
      } catch (err: any) { log.warn({ err: err?.message, newTaskId }, 'spawnNext: set start date failed'); }
    }

    // ── Copy custom-field values (skip relationship + rollup) ─────────────────
    try {
      const effective = await customFieldService.effectiveForTask(recurrence.taskId);
      for (const ef of effective) {
        const type = ef.field.type;
        // relationship lives in the TaskRelationships link table (not a CF value);
        // rollup is computed read-only with no stored value; progress_auto is
        // derived from subtasks. Skip all three.
        if (type === 'relationship' || type === 'rollup' || type === 'progress_auto') continue;
        if (ef.value === null || ef.value === undefined) continue;
        try {
          await customFieldService.setValue(newTaskId, ef.field.id, ef.value);
        } catch (err: any) { log.warn({ err: err?.message, fieldId: ef.field.id }, 'spawnNext: copy custom field failed'); }
      }
    } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: read custom fields failed'); }

    // ── Copy assignees (atomic set; SP filters out non-workspace members) ─────
    try {
      const assigneeIds = await this.sourceAssigneeIds(recurrence.taskId);
      if (assigneeIds.length) await this.taskRepo.setAssignees(newTaskId, assigneeIds);
    } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: copy assignees failed'); }

    // ── Copy watchers ─────────────────────────────────────────────────────────
    try {
      const watchers = await watcherService.list(recurrence.taskId);
      for (const w of watchers) {
        await watcherService.add(newTaskId, w.userId).catch(() => {});
      }
    } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: copy watchers failed'); }

    // ── Copy tags ─────────────────────────────────────────────────────────────
    try {
      const tags = await tagService.listForTask(recurrence.taskId);
      for (const t of tags) {
        await tagService.linkTask(newTaskId, (t as any).id).catch(() => {});
      }
    } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: copy tags failed'); }

    // ── Optionally clone dependency edges ─────────────────────────────────────
    if (recurrence.includeDependencies) {
      try {
        const { waitingOn, blocking } = await dependencyService.list(recurrence.taskId);
        for (const dep of waitingOn) {
          await dependencyService.add(newTaskId, dep.taskId, 'waiting_on', workspaceId).catch(() => {});
        }
        for (const dep of blocking) {
          await dependencyService.add(newTaskId, dep.taskId, 'blocking', workspaceId).catch(() => {});
        }
      } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: clone dependencies failed'); }
    }

    // NOTE (v1 deferral): subtasks + checklists are intentionally NOT cloned.

    // ── Advance the schedule + handle termination ─────────────────────────────
    // endsAt: computeNextOccurrence returns null once the next occurrence would
    //   fall past endsAt → deactivate.
    // count: enforced here. The rule carries a remaining budget; each spawn
    //   consumes one. When the budget hits 0 we deactivate; otherwise we persist
    //   the decremented count back into the rule JSON so the countdown survives
    //   across occurrences (the next spawn reads the reduced budget).
    const nextAfter = computeNextOccurrence(rule, newDue);
    let active = nextAfter !== null;
    let nextRunAt: Date | null = nextAfter;

    if (rule.count !== undefined) {
      const remaining = rule.count - 1;
      if (remaining <= 0) {
        active = false;
        nextRunAt = null;
      } else {
        await this.persistDecrementedCount(recurrence, remaining).catch((err) =>
          log.warn({ err: err?.message }, 'spawnNext: persist decremented count failed'));
      }
    }

    await this.repo.advanceAfterSpawn({
      id: recurrence.id,
      lastSpawnedTaskId: newTaskId,
      nextRunAt: active ? nextRunAt : null,
      active,
    });

    // Live event for boards/views.
    if (newProjectId) {
      await publishTaskEvent('created', { projectId: newProjectId, task: clone });
    }

    return newTaskId;
  }

  /** Source task assignee ids (workspace-scoped via the task's list). */
  private async sourceAssigneeIds(taskId: string): Promise<string[]> {
    const rows = await execSpOne<{ UserId: string }>('usp_Task_GetAssignees', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]).catch(() => [] as { UserId: string }[]);
    return rows.map((r) => r.UserId);
  }

  /** Patch the recurrence row's Rule JSON with a decremented `count` in place. */
  private async persistDecrementedCount(recurrence: TaskRecurrence, remaining: number): Promise<void> {
    const newRule = { ...recurrence.rule, count: remaining };
    await execSpOne('usp_TaskRecurrence_UpdateRule', [
      { name: 'Id',   type: sql.UniqueIdentifier,  value: recurrence.id },
      { name: 'Rule', type: sql.NVarChar(sql.MAX), value: JSON.stringify(newRule) },
    ]);
  }
}

export const recurrenceService = new RecurrenceService();
