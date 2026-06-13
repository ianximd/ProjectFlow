import { GoalRepository } from './goal.repository.js';
import { goalProgress, targetRatio, type TargetShape } from './goal-progress.js';
import { subLogger } from '../../shared/lib/logger.js';
import type { GoalFolder, Goal, Target, GoalWithProgress } from '@projectflow/types';

const log = subLogger('goals');

/** Thrown on invalid goal/target input → 422. Stable code. */
export class InvalidGoalError extends Error {
  code = 'INVALID_GOAL';
  constructor(message: string) { super(message); this.name = 'InvalidGoalError'; }
}

const VALID_KINDS = new Set(['number', 'boolean', 'currency', 'task']);
const VALID_STATUSES = new Set(['active', 'achieved', 'archived']);

/** A Target → the pure-math shape goal-progress.ts consumes. */
function toShape(t: Target): TargetShape {
  return { kind: t.kind, startValue: t.startValue, targetValue: t.targetValue, currentValue: t.currentValue };
}

export class GoalService {
  constructor(private repo = new GoalRepository()) {}

  // ── Folders ──
  createFolder(workspaceId: string, name: string, ownerId: string): Promise<GoalFolder> {
    if (!name?.trim()) throw new InvalidGoalError('Folder name is required');
    return this.repo.createFolder({ workspaceId, name: name.trim(), ownerId });
  }
  listFolders(workspaceId: string): Promise<GoalFolder[]> { return this.repo.listFolders(workspaceId); }
  async deleteFolder(id: string): Promise<void> { await this.repo.deleteFolder(id); }

  // ── Goals ──
  createGoal(input: {
    workspaceId: string; scopeType?: string; scopeId?: string | null; folderId?: string | null;
    name: string; description?: string | null; ownerId: string; dueDate?: string | null;
  }): Promise<Goal> {
    if (!input.name?.trim()) throw new InvalidGoalError('Goal name is required');
    const scopeType = (input.scopeType ?? 'WORKSPACE') as any;
    return this.repo.createGoal({
      workspaceId: input.workspaceId, scopeType, scopeId: input.scopeId ?? null,
      folderId: input.folderId ?? null, name: input.name.trim(),
      description: input.description ?? null, ownerId: input.ownerId, dueDate: input.dueDate ?? null,
    });
  }
  async updateGoal(id: string, input: {
    name?: string; description?: string | null; dueDate?: string | null;
    status?: string; folderId?: string | null;
  }): Promise<Goal | null> {
    if (input.status !== undefined && input.status !== null && !VALID_STATUSES.has(input.status))
      throw new InvalidGoalError(`status must be one of active|achieved|archived (got ${input.status})`);
    // ★ usp_Goal_Update ALWAYS assigns FolderId (so a goal can be un-foldered by
    // passing null). Therefore preserve the current folder when the caller did NOT
    // mention folderId at all (undefined) — only an EXPLICIT null un-folders. Without
    // this, a partial update (e.g. status-only via REST, or GraphQL updateGoal which
    // never sends folderId) would silently move the goal to unfoldered.
    let folderId = input.folderId;
    if (folderId === undefined) {
      const current = await this.repo.getGoal(id);
      folderId = current?.folderId ?? null;
    }
    return this.repo.updateGoal(id, {
      name: input.name ?? null, description: input.description ?? null,
      dueDate: input.dueDate ?? null, status: (input.status ?? null) as any,
      folderId,
    });
  }
  async deleteGoal(id: string): Promise<void> { await this.repo.deleteGoal(id); }
  getGoal(id: string): Promise<Goal | null> { return this.repo.getGoal(id); }
  listGoals(workspaceId: string, folderId: string | null = null): Promise<Goal[]> {
    return this.repo.listGoals(workspaceId, folderId);
  }
  getGoalWorkspaceId(id: string): Promise<string | null> { return this.repo.getGoalWorkspaceId(id); }

  /** A goal joined with its targets + computed progress (equal-weighted average). */
  async getGoalWithProgress(id: string): Promise<GoalWithProgress | null> {
    const goal = await this.repo.getGoal(id);
    if (!goal) return null;
    const targets = await this.repo.listTargets(id);
    return {
      ...goal,
      targets: targets.map((t) => ({ ...t, ratio: targetRatio(toShape(t)) })),
      progress: goalProgress(targets.map(toShape)),
    };
  }

  // ── Targets ──
  createTarget(goalId: string, input: {
    kind: string; name: string; unit?: string | null; currencyCode?: string | null;
    startValue?: number | null; targetValue?: number | null; currentValue?: number | null;
    taskFilter?: string | null;
  }): Promise<Target> {
    if (!VALID_KINDS.has(input.kind))
      throw new InvalidGoalError(`kind must be one of number|boolean|currency|task (got ${input.kind})`);
    if (!input.name?.trim()) throw new InvalidGoalError('Target name is required');
    if (input.taskFilter != null) {
      try { JSON.parse(input.taskFilter); }
      catch { throw new InvalidGoalError('taskFilter must be a JSON string'); }
    }
    return this.repo.createTarget({
      goalId, kind: input.kind as any, name: input.name.trim(),
      unit: input.unit ?? null, currencyCode: input.currencyCode ?? null,
      startValue: input.startValue ?? null, targetValue: input.targetValue ?? null,
      currentValue: input.currentValue ?? null, taskFilter: input.taskFilter ?? null,
    });
  }
  updateTarget(id: string, input: {
    name?: string; unit?: string | null; currencyCode?: string | null;
    startValue?: number | null; targetValue?: number | null; currentValue?: number | null;
    taskFilter?: string | null;
  }): Promise<Target | null> {
    if (input.taskFilter != null) {
      try { JSON.parse(input.taskFilter); }
      catch { throw new InvalidGoalError('taskFilter must be a JSON string'); }
    }
    return this.repo.updateTarget(id, input);
  }
  async deleteTarget(id: string): Promise<void> { await this.repo.deleteTarget(id); }
  listTargets(goalId: string): Promise<Target[]> { return this.repo.listTargets(goalId); }

  /**
   * Auto-rollup hook: when a task transitions, recompute every task-kind target
   * that counts it. BEST-EFFORT — invoked fire-and-forget after-commit from
   * TaskService.transitionTask; every error is swallowed here so a goal-rollup
   * failure can never fault the task transition the user asked for.
   */
  async recomputeForTask(taskId: string): Promise<void> {
    try {
      const targets = await this.repo.listTaskTargetsForTask(taskId);
      for (const tgt of targets) {
        await this.repo.recomputeTaskValue(tgt.id).catch((err: any) =>
          log.warn({ err: err?.message, targetId: tgt.id, taskId }, 'recomputeForTask: target recompute failed'));
      }
    } catch (err: any) {
      log.warn({ err: err?.message, taskId }, 'recomputeForTask: lookup failed');
    }
  }
}

export const goalService = new GoalService();
