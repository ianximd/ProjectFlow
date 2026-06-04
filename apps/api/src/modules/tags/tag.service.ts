import { randomUUID } from 'node:crypto';
import { TagRepository } from './tag.repository.js';
import type { Tag } from '@projectflow/types';

export class TagService {
  constructor(private repo: TagRepository = new TagRepository()) {}

  list(spaceId: string): Promise<Tag[]> { return this.repo.list(spaceId); }

  create(spaceId: string, name: string, color: string | null): Promise<Tag> {
    return this.repo.create(randomUUID().toUpperCase(), spaceId, name, color);
  }

  delete(id: string): Promise<void> { return this.repo.delete(id); }
  listForTask(taskId: string): Promise<Tag[]> { return this.repo.listForTask(taskId); }
  linkTask(taskId: string, tagId: string): Promise<void> { return this.repo.linkTask(taskId, tagId); }
  unlinkTask(taskId: string, tagId: string): Promise<void> { return this.repo.unlinkTask(taskId, tagId); }
  getWorkspaceId(id: string): Promise<string | null> { return this.repo.getWorkspaceId(id); }
}

export const tagService = new TagService();
