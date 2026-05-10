import { ProjectRepository } from './project.repository.js';

const repo = new ProjectRepository();

export const projectService = {
  create:  (workspaceId: string, name: string, key: string, description: string | null, type: string, createdById: string) =>
             repo.create(workspaceId, name, key, description, type, createdById),
  list:    (workspaceId: string) => repo.list(workspaceId),
  getById: (id: string) => repo.getById(id),
  update:  (id: string, fields: Parameters<typeof repo.update>[1]) => repo.update(id, fields),
  archive: (id: string) => repo.archive(id),
  delete:  (id: string) => repo.softDelete(id),
};
