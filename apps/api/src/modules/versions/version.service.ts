import { VersionRepository } from './version.repository.js';
import type { Version } from '@projectflow/types';

const repo = new VersionRepository();

export class VersionService {
  list(projectId: string)                              { return repo.list(projectId); }
  create(projectId: string, name: string, description: string | null, startDate: string | null, releaseDate: string | null) {
    return repo.create(projectId, name, description, startDate, releaseDate);
  }
  update(id: string, patch: Parameters<VersionRepository['update']>[1]) {
    return repo.update(id, patch);
  }
  delete(id: string)                                   { return repo.delete(id); }
}
