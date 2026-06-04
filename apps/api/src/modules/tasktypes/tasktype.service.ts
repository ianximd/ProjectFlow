import { randomUUID } from 'node:crypto';
import { TaskTypeRepository } from './tasktype.repository.js';
import type { TaskType } from '@projectflow/types';

const KNOWN = new Set(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST']);

/** Legacy Tasks.Type stays valid for board/roadmap: known enum name -> that enum; else TASK. */
export function legacyTypeForTaskType(tt: { nameSingular: string; isMilestone: boolean }): string {
  const up = tt.nameSingular.trim().toUpperCase();
  return KNOWN.has(up) ? up : 'TASK';
}

export class TaskTypeService {
  constructor(private repo: TaskTypeRepository = new TaskTypeRepository()) {}

  list(workspaceId: string): Promise<TaskType[]> { return this.repo.list(workspaceId); }

  create(input: {
    workspaceId: string; nameSingular: string; namePlural: string;
    icon?: string | null; isMilestone?: boolean; position?: number;
  }): Promise<TaskType> {
    const id = randomUUID().toUpperCase();
    return this.repo.create({
      id,
      workspaceId: input.workspaceId,
      nameSingular: input.nameSingular,
      namePlural: input.namePlural,
      icon: input.icon ?? null,
      isMilestone: !!input.isMilestone,
      position: input.position ?? 0,
    });
  }

  update(id: string, p: {
    nameSingular?: string; namePlural?: string; icon?: string | null; clearIcon?: boolean; position?: number;
  }): Promise<TaskType | null> { return this.repo.update(id, p); }

  delete(id: string): Promise<TaskType | null> { return this.repo.delete(id); }

  getWorkspaceId(id: string): Promise<string | null> { return this.repo.getWorkspaceId(id); }

  async setTaskType(taskId: string, taskTypeId: string): Promise<Record<string, unknown> | null> {
    const tt = await this.repo.getById(taskTypeId);
    if (!tt) return null;
    return this.repo.setTaskType(taskId, taskTypeId, legacyTypeForTaskType(tt));
  }
}

export const taskTypeService = new TaskTypeService();
