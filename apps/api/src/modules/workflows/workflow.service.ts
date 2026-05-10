import { WorkflowRepository } from './workflow.repository.js';
import type { WorkflowRow, WorkflowStatusRow, WorkflowTransitionRow } from './workflow.repository.js';

const repo = new WorkflowRepository();

function mapWorkflow(
  wf: WorkflowRow,
  statuses: WorkflowStatusRow[],
  transitions: WorkflowTransitionRow[],
) {
  return {
    id:          wf.Id,
    projectId:   wf.ProjectId,
    name:        wf.Name,
    isDefault:   wf.IsDefault,
    createdAt:   wf.CreatedAt,
    updatedAt:   wf.UpdatedAt,
    statuses:    statuses.map(s => ({
      id:         s.Id,
      workflowId: s.WorkflowId,
      name:       s.Name,
      category:   s.Category,
      color:      s.Color,
      position:   s.Position,
      createdAt:  s.CreatedAt,
    })),
    transitions: transitions.map(t => ({
      id:         t.Id,
      workflowId: t.WorkflowId,
      fromStatus: t.FromStatus,
      toStatus:   t.ToStatus,
      name:       t.Name,
      createdAt:  t.CreatedAt,
    })),
  };
}

export class WorkflowService {
  async create(projectId: string, name: string, template = 'DEFAULT') {
    const { workflow, statuses, transitions } = await repo.create(projectId, name, template);
    return mapWorkflow(workflow, statuses, transitions);
  }

  async getByProject(projectId: string) {
    const { workflow, statuses, transitions } = await repo.getByProject(projectId);
    if (!workflow) return null;
    return mapWorkflow(workflow, statuses, transitions);
  }

  async addStatus(workflowId: string, name: string, category: string, color: string) {
    const row = await repo.addStatus(workflowId, name, category, color);
    return row
      ? { id: row.Id, workflowId: row.WorkflowId, name: row.Name, category: row.Category, color: row.Color, position: row.Position }
      : null;
  }

  async updateStatus(statusId: string, name?: string | null, category?: string | null, color?: string | null, position?: number | null) {
    const row = await repo.updateStatus(statusId, name, category, color, position);
    return row
      ? { id: row.Id, workflowId: row.WorkflowId, name: row.Name, category: row.Category, color: row.Color, position: row.Position }
      : null;
  }

  async deleteStatus(statusId: string): Promise<void> {
    await repo.deleteStatus(statusId);
  }

  async addTransition(workflowId: string, fromStatus: string, toStatus: string, name?: string) {
    const row = await repo.addTransition(workflowId, fromStatus, toStatus, name);
    return row
      ? { id: row.Id, workflowId: row.WorkflowId, fromStatus: row.FromStatus, toStatus: row.ToStatus, name: row.Name }
      : null;
  }

  async removeTransition(workflowId: string, fromStatus: string, toStatus: string): Promise<void> {
    await repo.removeTransition(workflowId, fromStatus, toStatus);
  }
}
