import { WorkLogRepository } from './worklog.repository.js';
import type { WorkLog, WorkLogListResult } from '@projectflow/types';

const repo = new WorkLogRepository();

export class WorkLogService {
  listByTask(taskId: string): Promise<WorkLogListResult> {
    return repo.listByTask(taskId);
  }

  create(
    taskId:           string,
    userId:           string,
    timeSpentSeconds: number,
    startedAt:        string,
    description?:     string,
  ): Promise<WorkLog> {
    return repo.create(taskId, userId, timeSpentSeconds, startedAt, description);
  }

  update(
    id:     string,
    userId: string,
    patch: {
      timeSpentSeconds?: number;
      startedAt?:        string;
      description?:      string;
    },
  ): Promise<WorkLog | null> {
    return repo.update(id, userId, patch);
  }

  delete(id: string, userId: string): Promise<void> {
    return repo.delete(id, userId);
  }
}
