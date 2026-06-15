import type { HierarchyNodeType, ObjectPermissionGrant, ObjectPermissionLevel } from '@projectflow/types';
import { AccessRepository } from './access.repository.js';
import { writeAccessAudit } from './access.audit.js';

export const LEVEL_ORDER: Record<ObjectPermissionLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };

export class AccessService {
  constructor(private repo: AccessRepository = new AccessRepository()) {}

  async can(userId: string, objectType: HierarchyNodeType, objectId: string, min: ObjectPermissionLevel): Promise<boolean> {
    const { Level } = await this.repo.resolve(userId, objectType, objectId);
    if (!Level) return false;
    return LEVEL_ORDER[Level] >= LEVEL_ORDER[min];
  }

  async resolveOrNull(userId: string, objectType: HierarchyNodeType, objectId: string): Promise<{ level: ObjectPermissionLevel | null; found: boolean }> {
    const r = await this.repo.resolve(userId, objectType, objectId);
    return { level: r.Level, found: r.Found };
  }

  listObjectPermissions(objectType: HierarchyNodeType, objectId: string): Promise<ObjectPermissionGrant[]> {
    return this.repo.listForObject(objectType, objectId);
  }

  async setObjectPermission(input: {
    workspaceId: string; subjectType: 'USER' | 'ROLE'; subjectId: string;
    objectType: HierarchyNodeType; objectId: string; level: ObjectPermissionLevel;
    actorId: string; actorEmail?: string | null;
  }): Promise<void> {
    await this.repo.set(input.workspaceId, input.subjectType, input.subjectId, input.objectType, input.objectId, input.level, input.actorId);
    await writeAccessAudit({
      workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null,
      action: 'object.permission.set', resource: 'ObjectPermission', resourceId: input.objectId,
      newValues: { subjectType: input.subjectType, subjectId: input.subjectId, objectType: input.objectType, level: input.level },
    });
  }

  async removeObjectPermission(input: {
    workspaceId: string; subjectType: 'USER' | 'ROLE'; subjectId: string;
    objectType: HierarchyNodeType; objectId: string; actorId: string; actorEmail?: string | null;
  }): Promise<boolean> {
    const removed = await this.repo.remove(input.subjectType, input.subjectId, input.objectType, input.objectId);
    if (removed > 0) {
      await writeAccessAudit({
        workspaceId: input.workspaceId, userId: input.actorId, userEmail: input.actorEmail ?? null,
        action: 'object.permission.remove', resource: 'ObjectPermission', resourceId: input.objectId,
        oldValues: { subjectType: input.subjectType, subjectId: input.subjectId, objectType: input.objectType },
      });
    }
    return removed > 0;
  }
}

export const accessService = new AccessService();
