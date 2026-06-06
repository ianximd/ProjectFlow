import { RoadmapRepository } from './roadmap.repository.js';
import type { RoadmapItemRow } from './roadmap.repository.js';
import { dependencyService } from '../dependencies/dependency.service.js';
import { TaskRepository } from '../tasks/task.repository.js';

const repo = new RoadmapRepository();
const taskRepo = new TaskRepository();

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().split('T')[0] : null;
}

function mapItem(row: RoadmapItemRow) {
  let assignees: Array<{ id: string; name: string; avatarUrl: string | null }> = [];
  try {
    if (row.AssigneesJson) assignees = JSON.parse(row.AssigneesJson);
  } catch { /* ignore */ }

  return {
    id:            row.Id,
    issueKey:      row.IssueKey,
    title:         row.Title,
    type:          row.Type,
    status:        row.Status,
    priority:      row.Priority,
    startDate:     toIsoDate(row.StartDate),
    dueDate:       toIsoDate(row.DueDate),
    epicId:        row.EpicId,
    parentTaskId:  row.ParentTaskId,
    storyPoints:   row.StoryPoints,
    projectId:     row.ProjectId,
    projectName:   row.ProjectName,
    projectKey:    row.ProjectKey,
    assignees,
    childCount:     row.ChildCount,
    childDoneCount: row.ChildDoneCount,
  };
}

export class RoadmapService {
  async getItems(
    projectId: string | null,
    workspaceId: string | null,
    fromDate?: string | null,
    toDate?: string | null,
  ) {
    const { items, deps } = await repo.getItems(projectId, workspaceId, fromDate, toDate);
    return {
      items: items.map(mapItem),
      deps:  deps.map(d => ({ taskId: d.TaskId, dependsOn: d.DependsOn, type: d.Type })),
    };
  }

  async updateDates(
    taskId: string,
    requesterId: string,
    startDate?: string | null,
    dueDate?: string | null,
    clearStartDate?: boolean,
    clearDueDate?: boolean,
  ) {
    const row = await repo.updateDates(taskId, requesterId, startDate, dueDate, clearStartDate, clearDueDate);
    return row;
  }

  // Phase 5a: delegate to the canonical dependency edge service. The roadmap's
  // (taskId, dependsOn) pair means "taskId waits on dependsOn", which maps to
  // relation 'waiting_on' — the same direction the SP hard-codes. The legacy
  // `type` param is no longer carried by the edge (the SP fixes Type to
  // 'waiting_on'); it's accepted-and-ignored to preserve the route contract.
  async addDependency(taskId: string, dependsOn: string, _type?: string) {
    const workspaceId = await taskRepo.getWorkspaceId(taskId);
    if (!workspaceId) throw new Error('Task not found');
    return dependencyService.add(taskId, dependsOn, 'waiting_on', workspaceId);
  }

  async removeDependency(taskId: string, dependsOn: string) {
    return dependencyService.remove(taskId, dependsOn, 'waiting_on');
  }
}
