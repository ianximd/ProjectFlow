import { randomUUID } from 'node:crypto';
import { FolderRepository } from './folder.repository.js';
import { spacePath, folderPath } from './path.js';

export class FolderService {
  constructor(private repo: FolderRepository = new FolderRepository()) {}

  /** parentPath = the parent folder's Path, or spacePath(spaceId) when top-level. */
  async create(input: { workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position: number; parentPath: string }) {
    const id = randomUUID();
    const path = folderPath(input.parentPath, id);
    return this.repo.create({ id, workspaceId: input.workspaceId, spaceId: input.spaceId, parentFolderId: input.parentFolderId, name: input.name, position: input.position, path });
  }
  list(spaceId: string) { return this.repo.list(spaceId); }
  getById(id: string) { return this.repo.getById(id); }
  getWorkspaceId(id: string) { return this.repo.getWorkspaceId(id); }
  update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) { return this.repo.update(id, name, workflowId, clearWorkflow); }
  async move(id: string, newParentFolderId: string | null, newPosition: number, newParentPath: string) {
    const newPath = folderPath(newParentPath, id);
    return this.repo.move(id, newParentFolderId, newPosition, newPath);
  }
  delete(id: string) { return this.repo.softDelete(id); }
  spacePath = spacePath;  // helper for routes computing top-level parent path
}

export const folderService = new FolderService();
