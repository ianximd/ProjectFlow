import { AccessRequestRepository } from './access-request.repository.js';
import { accessService } from './access.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ViewRepository } from '../views/view.repository.js';
import type { AccessRequest, ShareObjectType, ObjectPermissionLevel, HierarchyNodeType } from '@projectflow/types';

const repo     = new AccessRequestRepository();
const taskRepo = new TaskRepository();
const viewRepo = new ViewRepository();

async function objectWorkspaceId(objectType: ShareObjectType, objectId: string): Promise<string | null> {
  if (objectType === 'task') return taskRepo.getWorkspaceId(objectId);
  if (objectType === 'view') return viewRepo.getWorkspaceId(objectId);
  return null;
}

/** The hierarchy node + id an ACL grant lands on (the ACL only knows
 *  SPACE/FOLDER/LIST). A task grant lands on the task's containing List. */
async function grantTarget(objectType: ShareObjectType, objectId: string): Promise<{ type: HierarchyNodeType; id: string } | null> {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST', id: listId } : null;
  }
  return null; // doc/dashboard/whiteboard/view node-mapping lands when those flows do
}

export const accessRequestService = {
  /** Non-mutating read for the authorize-THEN-mutate resolve flow. */
  getRequestById(id: string): Promise<AccessRequest | null> { return repo.getById(id); },

  async requestAccess(objectType: ShareObjectType, objectId: string, requesterId: string, note?: string): Promise<AccessRequest> {
    const workspaceId = await objectWorkspaceId(objectType, objectId);
    if (!workspaceId) throw new Error('OBJECT_NOT_FOUND');

    const request = await repo.create({ workspaceId, objectType, objectId, requestedBy: requesterId, note: note ?? null });

    // Phase 3.5 notification to the workspace's owners/admins.
    const recipientIds = await repo.listOwnerAdminIds(workspaceId);
    await notificationService.notify({
      recipientIds,
      actorId: requesterId,
      type: 'ACCESS_REQUESTED',
      payload: { accessRequestId: request.id, objectType, objectId, note: note ?? null },
    });
    return request;
  },

  /** Owner/admin resolves a request. The CALLER (route/resolver) has ALREADY
   *  enforced FULL on the object before calling this. On 'granted', mark the
   *  request resolved THEN write the ObjectPermissions grant via 10b's primitive. */
  async resolveRequest(
    id: string, resolverId: string, decision: 'granted' | 'denied',
    level: ObjectPermissionLevel = 'EDIT', resolverEmail: string | null = null,
  ): Promise<AccessRequest | null> {
    const resolved = await repo.resolve(id, decision, resolverId);
    if (!resolved) return null;

    if (decision === 'granted') {
      const target = await grantTarget(resolved.objectType, resolved.objectId);
      if (target) {
        await accessService.setObjectPermission({
          workspaceId: resolved.workspaceId, subjectType: 'USER', subjectId: resolved.requestedBy,
          objectType: target.type, objectId: target.id, level,
          actorId: resolverId, actorEmail: resolverEmail,
        });
      }
      await notificationService.notify({
        recipientIds: [resolved.requestedBy], actorId: resolverId,
        type: 'ACCESS_GRANTED', payload: { objectType: resolved.objectType, objectId: resolved.objectId },
      });
    }
    return resolved;
  },
};
