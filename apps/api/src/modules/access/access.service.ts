import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import { AccessRepository } from './access.repository.js';

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
}

export const accessService = new AccessService();
