import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';

export interface ResolvedAccess {
  Level: ObjectPermissionLevel | null;
  Found: boolean;
}

export class AccessRepository {
  async resolve(userId: string, objectType: HierarchyNodeType, objectId: string): Promise<ResolvedAccess> {
    const rows = await execSpOne<{ Level: ObjectPermissionLevel | null; Found: boolean }>(
      'usp_ObjectAccess_Resolve',
      [
        { name: 'UserId',     type: sql.UniqueIdentifier, value: userId },
        { name: 'ObjectType', type: sql.NVarChar(8),      value: objectType },
        { name: 'ObjectId',   type: sql.UniqueIdentifier, value: objectId },
      ],
    );
    const r = rows[0];
    return { Level: r?.Level ?? null, Found: Boolean(r?.Found) };
  }

  async set(
    workspaceId: string,
    subjectType: 'USER' | 'ROLE',
    subjectId: string,
    objectType: HierarchyNodeType,
    objectId: string,
    level: ObjectPermissionLevel,
  ) {
    const rows = await execSpOne('usp_ObjectPermission_Set', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'SubjectType', type: sql.NVarChar(8),      value: subjectType },
      { name: 'SubjectId',   type: sql.UniqueIdentifier, value: subjectId },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: objectId },
      { name: 'Level',       type: sql.NVarChar(8),      value: level },
    ]);
    return rows[0];
  }

  async unset(
    subjectType: 'USER' | 'ROLE',
    subjectId: string,
    objectType: HierarchyNodeType,
    objectId: string,
  ): Promise<void> {
    await execSpOne('usp_ObjectPermission_Unset', [
      { name: 'SubjectType', type: sql.NVarChar(8),      value: subjectType },
      { name: 'SubjectId',   type: sql.UniqueIdentifier, value: subjectId },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: objectId },
    ]);
  }
}
