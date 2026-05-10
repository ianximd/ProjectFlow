import { ComponentRepository } from './component.repository.js';

const repo = new ComponentRepository();

export class ComponentService {
  list(projectId: string)                                              { return repo.list(projectId); }
  create(projectId: string, name: string, description: string | null, leadUserId: string | null) {
    return repo.create(projectId, name, description, leadUserId);
  }
  update(id: string, patch: Parameters<ComponentRepository['update']>[1]) {
    return repo.update(id, patch);
  }
  delete(id: string) { return repo.delete(id); }
}
