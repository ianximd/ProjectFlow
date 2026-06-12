import { WorkLogRepository } from './worklog.repository.js';
import { estimateVsActual, type EstimateVsActual } from './rollup.js';
import type { WorkLog, WorkLogListResult, WorkLogSource, TaskTimeRollup } from '@projectflow/types';

const repo = new WorkLogRepository();

/**
 * Phase 8b — thrown when a worklog write targets a date inside a
 * submitted/approved Timesheet period. Routes map this to HTTP 422.
 */
export class PeriodLockedError extends Error {
  constructor() {
    super('Time period is locked by a submitted or approved timesheet');
    this.name = 'PeriodLockedError';
  }
}

export class WorkLogService {
  listByTask(taskId: string): Promise<WorkLogListResult> {
    return repo.listByTask(taskId);
  }

  async create(
    taskId:           string,
    userId:           string,
    timeSpentSeconds: number,
    startedAt:        string,
    opts: {
      description?: string;
      billable?:    boolean;
      source?:      WorkLogSource;
      endedAt?:     string;
      tagIds?:      string[];
    } = {},
  ): Promise<WorkLog> {
    if (await repo.isPeriodLocked(userId, startedAt)) throw new PeriodLockedError();
    const log = await repo.create(taskId, userId, timeSpentSeconds, startedAt, {
      description: opts.description,
      billable:    opts.billable,
      source:      opts.source,
      endedAt:     opts.endedAt,
    });
    if (opts.tagIds) log.tags = await repo.setTags(log.id, opts.tagIds);
    return log;
  }

  async update(
    id:     string,
    userId: string,
    patch: {
      timeSpentSeconds?: number;
      startedAt?:        string;
      description?:      string;
      billable?:         boolean;
      endedAt?:          string;
      tagIds?:           string[];
    },
  ): Promise<WorkLog | null> {
    // Phase 8b period-lock: locked time is immutable. Reject the update if the
    // entry's CURRENT work date is inside a submitted/approved period (you may
    // not edit locked time) OR if a new startedAt would MOVE it into one. We
    // must always read the existing row so an edit can't escape the lock by
    // moving the entry OUT of a locked period to an unlocked date. StartedAt is
    // PascalCase from usp_WorkLog_GetById.
    const existing = await repo.getById(id);
    const candidateDates: Array<string | Date> = [];
    if (existing?.StartedAt) candidateDates.push(existing.StartedAt as string | Date); // origin (current) date
    if (patch.startedAt)     candidateDates.push(patch.startedAt);                       // destination date
    for (const d of candidateDates) {
      const workDate = d instanceof Date ? d.toISOString() : String(d);
      if (await repo.isPeriodLocked(userId, workDate)) throw new PeriodLockedError();
    }
    const log = await repo.update(id, userId, {
      timeSpentSeconds: patch.timeSpentSeconds,
      startedAt:        patch.startedAt,
      description:      patch.description,
      billable:         patch.billable,
      endedAt:          patch.endedAt,
    });
    if (log && patch.tagIds) log.tags = await repo.setTags(log.id, patch.tagIds);
    return log;
  }

  delete(id: string, userId: string): Promise<void> {
    return repo.delete(id, userId);
  }

  startTimer(taskId: string, userId: string): Promise<WorkLog> {
    return repo.startTimer(taskId, userId);
  }

  stopTimer(userId: string): Promise<WorkLog | null> {
    return repo.stopTimer(userId);
  }

  getActiveTimer(userId: string): Promise<WorkLog | null> {
    return repo.getActiveTimer(userId);
  }

  setEstimate(taskId: string, userId: string | null, estimateSeconds: number | null): Promise<void> {
    return repo.setEstimate(taskId, userId, estimateSeconds);
  }

  async getRollup(taskId: string): Promise<TaskTimeRollup & { estimateVsActual: EstimateVsActual }> {
    const rollup = await repo.getTimeRollup(taskId);
    return { ...rollup, estimateVsActual: estimateVsActual(rollup) };
  }
}
