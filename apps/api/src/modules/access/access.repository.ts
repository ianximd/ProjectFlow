import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { HierarchyNodeType, ObjectPermissionGrant, ObjectPermissionLevel } from '@projectflow/types';

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
    grantedBy: string | null = null,
  ) {
    const rows = await execSpOne('usp_ObjectPermission_Set', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'SubjectType', type: sql.NVarChar(8),      value: subjectType },
      { name: 'SubjectId',   type: sql.UniqueIdentifier, value: subjectId },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: objectId },
      { name: 'Level',       type: sql.NVarChar(8),      value: level },
      { name: 'GrantedBy',   type: sql.UniqueIdentifier, value: grantedBy },
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

  async remove(subjectType: 'USER' | 'ROLE', subjectId: string, objectType: HierarchyNodeType, objectId: string): Promise<number> {
    const rows = await execSpOne<{ Deleted: number }>('usp_ObjectPermission_Remove', [
      { name: 'SubjectType', type: sql.NVarChar(8),      value: subjectType },
      { name: 'SubjectId',   type: sql.UniqueIdentifier, value: subjectId },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: objectId },
    ]);
    return Number(rows[0]?.Deleted ?? 0);
  }

  async listForObject(objectType: HierarchyNodeType, objectId: string): Promise<ObjectPermissionGrant[]> {
    const rows = await execSpOne<any>('usp_ObjectPermission_ListForObject', [
      { name: 'ObjectType', type: sql.NVarChar(8),      value: objectType },
      { name: 'ObjectId',   type: sql.UniqueIdentifier, value: objectId },
    ]);
    return rows.map((r) => ({
      id: r.Id, subjectType: r.SubjectType, subjectId: r.SubjectId,
      subjectName: r.SubjectName ?? null, subjectEmail: r.SubjectEmail ?? null,
      objectType: r.ObjectType, objectId: r.ObjectId, level: r.Level,
      inherited: Boolean(r.Inherited), inheritedFromName: r.InheritedFromName ?? null,
    }));
  }
}
