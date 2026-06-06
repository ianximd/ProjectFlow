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
    const now = new Date();
    const sourceDue = asDate(pick(source, 'dueDate', 'DueDate')) ?? now;
    let nextRunAt = computeNextOccurrence(rule, sourceDue);
    // Past-due seed clamp: if the source's due date is already behind us, the
    // first occurrence computed from it can land in the past, which would make
    // the scheduled sweep fire immediately (and repeatedly, until it catches up).
    // Re-seed from `now` so the first scheduled fire is in the future.
    if (nextRunAt && nextRunAt < now) nextRunAt = computeNextOccurrence(rule, now);

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
   * Spawn the next occurrence of a recurrence: CLAIM the occurrence atomically,
   * then clone the source task with remapped dates + reset status, copy
   * sub-objects. Best-effort sub-object copies (each guarded) — a copy failure
   * logs but does not abort the spawn. Returns the new task id, or null when
   * nothing spawned (rule ended / source missing / occurrence already claimed by
   * a concurrent spawn).
   *
   * Concurrency (FIX 1): the on-complete trigger and the scheduled sweep can both
   * reach here for the SAME occurrence (mode 'both'). To prevent a double-spawn
   * and a lost count decrement, we CLAIM FIRST: a CONDITIONAL UPDATE keyed on the
   * recurrence's currently-observed NextRunAt (passed as @ExpectedNextRunAt).
   * Exactly one caller's WHERE matches; the loser sees claimed=false and returns
   * without spawning. The count decrement is folded into that SAME atomic UPDATE
   * (the new Rule JSON), so there is no separate read-then-write count race.
   *
   * Clone-after-claim tradeoff: claiming before cloning means a clone FAILURE
   * leaves the schedule advanced without a clone for that occurrence — i.e. the
   * occurrence is SKIPPED. This is deliberate: a skipped occurrence is strictly
   * better than the alternative double-spawn, and the failure is logged. The
   * clone + sub-object copies are wrapped in try/catch so a failure can't throw
   * past the (already-committed) claim.
   */
  async spawnNext(recurrence: TaskRecurrence): Promise<string | null> {
    const rule = recurrence.rule as RecurrenceRuleShape;
    // The value we will claim against — the row's NextRunAt as we observed it.
    const expectedNextRunAt = asDate(recurrence.nextRunAt as any);

    const source = await this.taskRepo.getById(recurrence.taskId);
    if (!source) {
      log.warn({ recurrenceId: recurrence.id, taskId: recurrence.taskId }, 'spawnNext: source task missing — deactivating');
      // Claim-and-deactivate: only the caller that still sees the expected
      // NextRunAt wins; a concurrent spawn that already advanced loses (no-op).
      await this.repo.advanceAfterSpawn({
        id: recurrence.id, lastSpawnedTaskId: recurrence.taskId,
        nextRunAt: null, active: false, expectedNextRunAt,
      });
      return null;
    }

    const s = source as any;
    const workspaceId = recurrence.workspaceId;

    // ── Remap dates (computed up front, before the claim) ─────────────────────
    // New due = next occurrence after the source's due (or now). New start
    // preserves the source's start→due duration (in whole days) when both exist.
    const sourceDue = asDate(pick(s, 'dueDate', 'DueDate')) ?? new Date();
    const sourceStart = asDate(pick(s, 'startDate', 'StartDate'));
    const newDue = computeNextOccurrence(rule, sourceDue);
    if (!newDue) {
      // Rule ended (endsAt passed) → nothing to spawn; claim-and-deactivate.
      await this.repo.advanceAfterSpawn({
        id: recurrence.id, lastSpawnedTaskId: recurrence.taskId,
        nextRunAt: null, active: false, expectedNextRunAt,
      });
      return null;
    }
    let newStart: Date | null = null;
    if (sourceStart && asDate(pick(s, 'dueDate', 'DueDate'))) {
      const durationDays = Math.round((sourceDue.getTime() - sourceStart.getTime()) / MS_PER_DAY);
      newStart = new Date(newDue.getTime() - durationDays * MS_PER_DAY);
    }

    // ── Compute the advanced schedule + termination up front ──────────────────
    // endsAt: computeNextOccurrence returns null once the next occurrence would
    //   fall past endsAt → deactivate.
    // count: the rule carries a remaining budget; each spawn consumes one. When
    //   the budget hits 0 we deactivate; otherwise we fold the decremented count
    //   into the claim's Rule JSON so the countdown survives across occurrences.
    const nextAfter = computeNextOccurrence(rule, newDue);
    let active = nextAfter !== null;
    let nextRunAt: Date | null = nextAfter;
    let newRuleJson: string | null = null;

    if (rule.count !== undefined) {
      const remaining = rule.count - 1;
      if (remaining <= 0) {
        active = false;
        nextRunAt = null;
      } else {
        newRuleJson = JSON.stringify({ ...recurrence.rule, count: remaining });
      }
    }

    // ── CLAIM FIRST (atomic) ──────────────────────────────────────────────────
    // Tentatively point LastSpawnedTaskId at the SOURCE; we re-stamp it to the
    // real clone id after a successful create. The claim's WHERE guarantees only
    // one concurrent caller proceeds past this point for this occurrence.
    const { claimed } = await this.repo.advanceAfterSpawn({
      id: recurrence.id,
      lastSpawnedTaskId: recurrence.taskId,
      nextRunAt: active ? nextRunAt : null,
      active,
      expectedNextRunAt,
      rule: newRuleJson,
    });
    if (!claimed) {
      // Another spawn (on-complete vs. sweep) already advanced this occurrence.
      log.debug({ recurrenceId: recurrence.id, taskId: recurrence.taskId }, 'spawnNext: occurrence already claimed — skipping');
      return null;
    }

    // ── Clone + copy sub-objects (post-claim; guarded so a failure can't escape) ─
    // On a clone failure we log and return null: the schedule is already advanced
    // (occurrence SKIPPED), which is the documented tradeoff vs. a double-spawn.
    try {
      // Reset status to the list's first effective status (fallback to source).
      const listId = pick<string>(s, 'listId', 'ListId');
      let resetStatus = pick<string>(s, 'status', 'Status') ?? 'To Do';
      if (listId) {
        const statuses = await this.listRepo.effectiveStatuses(listId).catch(() => []);
        if (statuses.length) resetStatus = (statuses[0] as any).name ?? (statuses[0] as any).Name ?? resetStatus;
      }

      // Clone the core task via usp_Task_Create.
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

      // Re-stamp LastSpawnedTaskId to the actual clone. This caller already holds
      // the claim, so the unconditional stamp races nothing (and works even when
      // the claim just deactivated the row on the final/count-exhausted occurrence).
      await this.repo.setLastSpawned(recurrence.id, newTaskId)
        .catch((err) => log.warn({ err: err?.message, recurrenceId: recurrence.id }, 'spawnNext: re-stamp lastSpawned failed'));

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

      // Copy custom-field values (skip relationship + rollup + progress_auto).
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

      // Copy assignees (atomic set; SP filters out non-workspace members).
      try {
        const assigneeIds = await this.sourceAssigneeIds(recurrence.taskId);
        if (assigneeIds.length) await this.taskRepo.setAssignees(newTaskId, assigneeIds);
      } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: copy assignees failed'); }

      // Copy watchers.
      try {
        const watchers = await watcherService.list(recurrence.taskId);
        for (const w of watchers) {
          await watcherService.add(newTaskId, w.userId).catch(() => {});
        }
      } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: copy watchers failed'); }

      // Copy tags.
      try {
        const tags = await tagService.listForTask(recurrence.taskId);
        for (const t of tags) {
          await tagService.linkTask(newTaskId, (t as any).id).catch(() => {});
        }
      } catch (err: any) { log.warn({ err: err?.message }, 'spawnNext: copy tags failed'); }

      // Optionally clone dependency edges.
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

      // Live event for boards/views.
      if (newProjectId) {
        await publishTaskEvent('created', { projectId: newProjectId, task: clone });
      }

      return newTaskId;
    } catch (err: any) {
      // Clone failed AFTER the claim advanced the schedule → occurrence skipped.
      log.error({ err: err?.message, recurrenceId: recurrence.id, taskId: recurrence.taskId }, 'spawnNext: clone failed after claim — occurrence skipped');
      return null;
    }
  }

  /** Source task assignee ids (workspace-scoped via the task's list). */
  private async sourceAssigneeIds(taskId: string): Promise<string[]> {
    const rows = await execSpOne<{ UserId: string }>('usp_Task_GetAssignees', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]).catch((err: any) => {
      // Don't silently swallow: a read failure here means the spawned clone
      // loses its assignees, which is worth surfacing in logs.
      log.warn({ err: err?.message, taskId }, 'sourceAssigneeIds: read assignees failed — clone will have none');
      return [] as { UserId: string }[];
    });
    return rows.map((r) => r.UserId);
  }

  // NOTE (FIX 1): the previous `persistDecrementedCount` (a separate
  // usp_TaskRecurrence_UpdateRule read-then-write) is retired. The decremented
  // `count` is now folded into the atomic claim's Rule JSON inside spawnNext, so
  // the count persist and the schedule advance happen in ONE conditional UPDATE
  // with no read-then-write race.
}

export const recurrenceService = new RecurrenceService();
