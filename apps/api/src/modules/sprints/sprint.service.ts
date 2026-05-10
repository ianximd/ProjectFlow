import { SprintRepository } from './sprint.repository.js';
import { webhookOutgoingService } from '../webhooks/webhook-outgoing.service.js';

const repo = new SprintRepository();

export const sprintService = {
  create:   (projectId: string, name: string, goal: string | null, startDate: Date | null, endDate: Date | null) =>
              repo.create(projectId, name, goal, startDate, endDate),
  list:     (projectId: string) => repo.list(projectId),

  start: async (id: string) => {
    const sprint = await repo.start(id);
    if (sprint) {
      webhookOutgoingService.dispatch(
        (sprint as any).WorkspaceId ?? '', 'sprint.started',
        { id: (sprint as any).Id, name: (sprint as any).Name, projectId: (sprint as any).ProjectId },
      ).catch(() => {});
    }
    return sprint;
  },

  complete: async (id: string) => {
    const sprint = await repo.complete(id);
    if (sprint) {
      webhookOutgoingService.dispatch(
        (sprint as any).WorkspaceId ?? '', 'sprint.completed',
        { id: (sprint as any).Id, name: (sprint as any).Name, projectId: (sprint as any).ProjectId },
      ).catch(() => {});
    }
    return sprint;
  },
};
