import { DocsRepository } from './docs.repository.js';
import { positionBetween, FIRST_POSITION } from './fractionalIndex.js';
import { TaskService } from '../tasks/task.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import type {
  Doc, DocPage, DocPageVersionMeta, DocTaskLink, DocScopeType, DocTaskLinkKind,
} from '@projectflow/types';

const repo        = new DocsRepository();
const listRepo    = new ListRepository();

/** Compute the fractional Position for a new/moved page among its siblings. */
function computePosition(
  siblings: DocPage[], parentPageId: string | null, afterPageId: string | null,
): number {
  const peers = siblings
    .filter((p) => (p.parentPageId ?? null) === (parentPageId ?? null))
    .sort((a, b) => a.position - b.position);
  if (peers.length === 0) return FIRST_POSITION;
  if (afterPageId === null) return positionBetween(null, peers[0].position);       // prepend
  const idx = peers.findIndex((p) => p.id === afterPageId);
  if (idx === -1) return positionBetween(peers[peers.length - 1].position, null);  // append fallback
  const before = peers[idx].position;
  const after  = idx + 1 < peers.length ? peers[idx + 1].position : null;
  return positionBetween(before, after);
}

export class DocsService {
  createDoc(
    workspaceId: string, scopeType: DocScopeType, scopeId: string,
    name: string, icon: string | null, userId: string,
  ) {
    return repo.createDoc(workspaceId, scopeType, scopeId, name, icon, userId);
  }

  getDoc(docId: string): Promise<Doc | null> {
    return repo.getDoc(docId);
  }

  listDocsByScope(scopeType: DocScopeType, scopeId: string): Promise<Doc[]> {
    return repo.listDocsByScope(scopeType, scopeId);
  }

  setWiki(docId: string, isWiki: boolean, userId: string): Promise<Doc | null> {
    return repo.setWiki(docId, isWiki, isWiki ? userId : null);
  }

  resolveScopeNode(docPageId: string) {
    return repo.resolveScopeNode(docPageId);
  }

  getPage(pageId: string): Promise<DocPage | null> {
    return repo.getPage(pageId);
  }

  listPages(docId: string): Promise<DocPage[]> {
    return repo.listPages(docId);
  }

  async createPage(
    docId: string, parentPageId: string | null,
    title: string | undefined, icon: string | undefined,
    afterPageId: string | null,
  ): Promise<DocPage> {
    const siblings = await repo.listPages(docId);
    const position = computePosition(siblings, parentPageId, afterPageId);
    return repo.createPage(docId, parentPageId, title ?? 'Untitled', icon ?? null, position);
  }

  updatePage(pageId: string, patch: { title?: string; icon?: string; cover?: string }): Promise<DocPage | null> {
    return repo.updatePage(pageId, patch);
  }

  async movePage(
    pageId: string, parentPageId: string | null, afterPageId: string | null,
  ): Promise<DocPage | null> {
    const page = await repo.getPage(pageId);
    if (!page) return null;
    const siblings = await repo.listPages(page.docId);
    const position = computePosition(
      siblings.filter((p) => p.id !== pageId), parentPageId, afterPageId,
    );
    return repo.movePage(pageId, parentPageId, position);
  }

  deletePage(pageId: string): Promise<void> {
    return repo.deletePage(pageId);
  }

  createVersion(pageId: string, snapshot: string, userId: string): Promise<DocPageVersionMeta> {
    return repo.createVersion(pageId, snapshot, userId);
  }

  listVersions(pageId: string): Promise<DocPageVersionMeta[]> {
    return repo.listVersions(pageId);
  }

  restoreVersion(pageId: string, versionId: string, userId: string): Promise<DocPage | null> {
    return repo.restoreVersion(pageId, versionId, userId);
  }

  listLinks(docPageId: string): Promise<DocTaskLink[]> {
    return repo.listLinks(docPageId);
  }

  /** Thin passthrough: attach an existing task to a doc page. */
  createLink(docPageId: string, taskId: string, kind: DocTaskLinkKind): Promise<DocTaskLink> {
    return repo.createLink(docPageId, taskId, kind);
  }

  deleteLink(linkId: string): Promise<void> {
    return repo.deleteLink(linkId);
  }

  /**
   * Create a task in a list from a doc selection, then link it back to the page.
   *
   * Resolves projectId and workspaceId from the target list (authoritative) so
   * the task is correctly scoped regardless of the doc's own scope node.
   */
  async createTaskFromSelection(
    docPageId: string,
    listId: string,
    title: string,
    actorId: string,
    kind: DocTaskLinkKind = 'reference',
  ): Promise<DocTaskLink> {
    // Derive workspaceId and projectId from the target list — the authoritative source.
    const [workspaceId, listRow] = await Promise.all([
      listRepo.getWorkspaceId(listId),
      listRepo.getById(listId),
    ]);

    if (!workspaceId) throw Object.assign(new Error('List not found'), { statusCode: 404 });

    // SpaceId on the list row is the project (Space) id.
    const projectId: string = (listRow as any)?.SpaceId ?? (listRow as any)?.spaceId ?? workspaceId;

    const taskService = new TaskService(new TaskRepository());
    const task = await taskService.createTask(
      { projectId, workspaceId, title, listId, reporterId: actorId },
      actorId,
    );

    // task.repository.create returns the raw `SELECT *` row (PascalCase), so
    // the camelCase `task.id` is undefined at runtime — read case-tolerantly.
    const taskId = (task as { id?: string; Id?: string }).id ?? (task as { id?: string; Id?: string }).Id;
    return repo.createLink(docPageId, taskId as string, kind);
  }
}

export const docsService = new DocsService();
