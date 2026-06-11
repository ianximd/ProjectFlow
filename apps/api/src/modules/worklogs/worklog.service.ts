import { WorkLogRepository } from './worklog.repository.js';
import { estimateVsActual, type EstimateVsActual } from './rollup.js';
import type { WorkLog, WorkLogListResult, WorkLogSource, TaskTimeRollup } from '@projectflow/types';

const repo = new WorkLogRepository();

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
