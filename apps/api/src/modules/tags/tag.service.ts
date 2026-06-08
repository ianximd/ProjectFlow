import { randomUUID } from 'node:crypto';
import { TagRepository } from './tag.repository.js';
import type { Tag } from '@projectflow/types';

export class TagService {
  constructor(private repo: TagRepository = new TagRepository()) {}

  list(spaceId: string): Promise<Tag[]> { return this.repo.list(spaceId); }

  create(spaceId: string, name: string, color: string | null): Promise<Tag> {
    return this.repo.create(randomUUID().toUpperCase(), spaceId, name, color);
  }

  /**
   * Resolve a tag id by name within a Space, creating it when absent.
   * Used by the automation ADD_TAG action when a rule references a tag by name
   * rather than id. Match is case-insensitive against the Space's tag list.
   */
  async resolveOrCreate(spaceId: string, name: string): Promise<string> {
    const existing = await this.repo.list(spaceId);
    const match = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) return match.id;
    const created = await this.repo.create(randomUUID().toUpperCase(), spaceId, name, null);
    return created.id;
  }

  delete(id: string): Promise<void> { return this.repo.delete(id); }
  listForTask(taskId: string): Promise<Tag[]> { return this.repo.listForTask(taskId); }
  linkTask(taskId: string, tagId: string): Promise<void> { return this.repo.linkTask(taskId, tagId); }
  unlinkTask(taskId: string, tagId: string): Promise<void> { return this.repo.unlinkTask(taskId, tagId); }
  getWorkspaceId(id: string): Promise<string | null> { return this.repo.getWorkspaceId(id); }
}

export const tagService = new TagService();
