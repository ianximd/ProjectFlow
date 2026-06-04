import { randomUUID } from 'node:crypto';
import { ListRepository } from './list.repository.js';
import { FolderRepository } from './folder.repository.js';
import { spacePath, listPath } from './path.js';

export interface EffectiveStatus { id: string; name: string; category: string; color: string | null; position: number; }

export class ListService {
  constructor(
    private repo: ListRepository = new ListRepository(),
    private folders: FolderRepository = new FolderRepository(),
  ) {}

  /** parentPath = the folder's Path (if folderId), else spacePath(spaceId). */
  async parentPath(spaceId: string, folderId: string | null): Promise<string | null> {
    if (!folderId) return spacePath(spaceId);
    const f = await this.folders.getById(folderId);
    return f ? (f as any).Path : null;
  }

  async create(input: { workspaceId: string; spaceId: string; folderId: string | null; name: string; position: number; parentPath: string; isDefault?: boolean }) {
    // Uppercase to match SQL Server's canonical UNIQUEIDENTIFIER string form,
    // so the materialized Path segments equal the ids the DB returns.
    const id = randomUUID().toUpperCase();
    const path = listPath(input.parentPath, id);
    return this.repo.create({ id, workspaceId: input.workspaceId, spaceId: input.spaceId, folderId: input.folderId, name: input.name, position: input.position, path, isDefault: input.isDefault });
  }
  list(spaceId: string, folderId: string | null = null, allInSpace = true) { return this.repo.list(spaceId, folderId, allInSpace); }
  getWorkspaceId(id: string) { return this.repo.getWorkspaceId(id); }
  update(id: string, name?: string, workflowId?: string | null, clearWorkflow = false) { return this.repo.update(id, name, workflowId, clearWorkflow); }
  async move(id: string, newFolderId: string | null, newPosition: number, newParentPath: string) {
    const newPath = listPath(newParentPath, id);
    return this.repo.move(id, newFolderId, newPosition, newPath);
  }
  delete(id: string) { return this.repo.softDelete(id); }
  async effectiveStatuses(listId: string): Promise<EffectiveStatus[]> {
    const rows = await this.repo.effectiveStatuses(listId);
    return (rows as any[]).map((r) => ({ id: r.Id, name: r.Name, category: r.Category, color: r.Color ?? null, position: r.Position }));
  }
}

export const listService = new ListService();
