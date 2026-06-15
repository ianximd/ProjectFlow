import { ShareRepository } from './share.repository.js';
import { generateShareToken, isLinkLive } from './share.token.js';
import {
  buildTaskProjection, buildViewProjection,
  buildDocProjection, buildDashboardProjection, buildWhiteboardProjection,
} from './share.projection.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ViewRepository } from '../views/view.repository.js';
import type { ShareLink, ShareObjectType, ShareProjection, CreateShareLinkInput } from '@projectflow/types';

const repo     = new ShareRepository();
const taskRepo = new TaskRepository();
const viewRepo = new ViewRepository();

export class ShareService {
  /** Create a public link. Authz (share.create + FULL on the object) is enforced
   *  by the caller; the service owns token generation. Read-only (VIEW) in v1. */
  async createLink(workspaceId: string, input: CreateShareLinkInput, createdBy: string): Promise<ShareLink> {
    return repo.create({
      workspaceId,
      objectType: input.objectType,
      objectId:   input.objectId,
      token:      generateShareToken(),
      level:      'VIEW',
      expiresAt:  input.expiresAt ?? null,
      createdBy,
    });
  }

  /** Non-mutating read for the authorize-THEN-mutate revoke flow. */
  getLinkById(id: string): Promise<ShareLink | null> { return repo.getById(id); }

  revokeLink(id: string): Promise<ShareLink | null> { return repo.revoke(id); }

  listForObject(objectType: ShareObjectType, objectId: string): Promise<ShareLink[]> {
    return repo.listForObject(objectType, objectId);
  }

  /**
   * THE UNAUTHENTICATED RESOLVER. Token -> read-only, navigation-stripped
   * projection of EXACTLY one object, or null (-> 404 at the route). NEVER
   * consults workspace membership, the ACL resolver, or the hierarchy tree.
   */
  async resolvePublic(token: string): Promise<ShareProjection | null> {
    const link = await repo.resolve(token);          // SP filters dead links
    if (!link || !isLinkLive(link)) return null;     // belt-and-suspenders

    switch (link.objectType) {
      case 'task': {
        const row = await taskRepo.getById(link.objectId);
        return row ? buildTaskProjection(row as any) : null;
      }
      case 'view': {
        const row = await viewRepo.getById(link.objectId);
        return row ? buildViewProjection(row as any) : null;
      }
      case 'doc':        try { return buildDocProjection({}); }        catch { return null; }
      case 'dashboard':  try { return buildDashboardProjection({}); }  catch { return null; }
      case 'whiteboard': try { return buildWhiteboardProjection({}); } catch { return null; }
      default:           return null;
    }
  }

  /** Workspace lookup for the FULL-on-object gate. task/view only in v1. */
  async getObjectWorkspaceId(objectType: ShareObjectType, objectId: string): Promise<string | null> {
    switch (objectType) {
      case 'task': return taskRepo.getWorkspaceId(objectId);
      case 'view': return viewRepo.getWorkspaceId(objectId);
      default:     return null;
    }
  }
}

export const shareService = new ShareService();
