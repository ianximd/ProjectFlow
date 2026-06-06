import { DependencyRepository } from './dependency.repository.js';
import type { DependencyRelation, TaskDependencyLists } from '@projectflow/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A blocked task cannot transition to a DONE-group status while it has open blockers. */
export class DependencyWarningError extends Error {
  code = 'DEPENDENCY_BLOCKED';
  constructor(public blockers: { taskId: string; title: string; status: string }[]) {
    super('Task has open blockers');
    this.name = 'DependencyWarningError';
  }
}

/** A date-bearing record, casing-tolerant: task SPs return PascalCase (SELECT *). */
type DateHolder = {
  startDate?: Date | string | null; StartDate?: Date | string | null;
  dueDate?: Date | string | null;   DueDate?: Date | string | null;
} | null | undefined;

function readDate(h: DateHolder, key: 'start' | 'due'): Date | null {
  if (!h) return null;
  const raw = key === 'due'
    ? ((h as any).dueDate ?? (h as any).DueDate ?? null)
    : ((h as any).startDate ?? (h as any).StartDate ?? null);
  if (raw === null || raw === undefined) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whole-day delta between `before` and `after`, comparing dueDate (falling back
 * to startDate when both sides lack a dueDate). Returns 0 when either side is
 * null or the date is unchanged. Tasks.StartDate/DueDate are SQL DATE columns,
 * so the meaningful unit is whole days.
 */
export function computeDateDelta(before: DateHolder, after: DateHolder): number {
  // Prefer dueDate; fall back to startDate only when neither side has a dueDate.
  const beforeDue = readDate(before, 'due');
  const afterDue = readDate(after, 'due');
  let from = beforeDue;
  let to = afterDue;
  if (from === null && to === null) {
    from = readDate(before, 'start');
    to = readDate(after, 'start');
  }
  if (from === null || to === null) return 0;
  // Normalize to UTC midnight so DATE-column round-trips don't introduce
  // sub-day noise, then take whole days.
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

export class DependencyService {
  constructor(private repo = new DependencyRepository()) {}

  // relation 'waiting_on': (taskId waits_on otherId).
  // relation 'blocking':   (otherId waits_on taskId).
  async add(taskId: string, otherId: string, relation: DependencyRelation, workspaceId: string) {
    const [w, d] = relation === 'waiting_on' ? [taskId, otherId] : [otherId, taskId];
    return this.repo.add(w, d, workspaceId);
  }

  async remove(taskId: string, otherId: string, relation: DependencyRelation): Promise<number> {
    const [w, d] = relation === 'waiting_on' ? [taskId, otherId] : [otherId, taskId];
    return this.repo.remove(w, d);
  }

  async list(taskId: string): Promise<TaskDependencyLists> {
    const { waitingOn, blocking } = await this.repo.listForTask(taskId);
    return { waitingOn, blocking };
  }

  /** Throws DependencyWarningError when the task has one or more open blockers. */
  async assertNoOpenBlockers(taskId: string): Promise<void> {
    const open = await this.repo.openBlockers(taskId);
    if (open.length) throw new DependencyWarningError(open);
  }

  /** Shift dependents by `deltaDays` whole days; returns the shifted task ids. */
  async rescheduleDependents(taskId: string, deltaDays: number): Promise<string[]> {
    return this.repo.rescheduleDependents(taskId, deltaDays);
  }
}

export const dependencyService = new DependencyService();
