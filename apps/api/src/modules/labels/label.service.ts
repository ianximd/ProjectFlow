import { LabelRepository } from './label.repository.js';

const repo = new LabelRepository();

export class LabelService {
  list(projectId: string)                                     { return repo.list(projectId); }
  create(projectId: string, name: string, color: string)     { return repo.create(projectId, name, color); }
  update(id: string, patch: { name?: string; color?: string }) { return repo.update(id, patch); }
  delete(id: string)                                         { return repo.delete(id); }
}
