import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { AccessRequest, ShareObjectType, AccessRequestStatus } from '@projectflow/types';

interface AccessRequestRow {
  Id: string; WorkspaceId: string; ObjectType: ShareObjectType; ObjectId: string;
  RequestedBy: string; Note: string | null; Status: AccessRequestStatus;
  ResolvedBy: string | null; ResolvedAt: Date | null; CreatedAt: Date;
}

function rowToReq(r: AccessRequestRow): AccessRequest {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, objectType: r.ObjectType, objectId: r.ObjectId,
    requestedBy: r.RequestedBy, note: r.Note, status: r.Status,
    resolvedBy: r.ResolvedBy,
    resolvedAt: r.ResolvedAt ? (r.ResolvedAt instanceof Date ? r.ResolvedAt.toISOString() : String(r.ResolvedAt)) : null,
    createdAt: r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
  };
}

export class AccessRequestRepository {
  async create(p: { workspaceId: string; objectType: ShareObjectType; objectId: string; requestedBy: string; note: string | null }): Promise<AccessRequest> {
    const rows = await execSpOne<AccessRequestRow>('usp_AccessRequest_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ObjectType',  type: sql.NVarChar(16),     value: p.objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: p.objectId },
      { name: 'RequestedBy', type: sql.UniqueIdentifier, value: p.requestedBy },
      { name: 'Note',        type: sql.NVarChar(500),    value: p.note },
    ]);
    return rowToReq(rows[0]);
  }

  /** Non-mutating read for the authorize-then-mutate resolve flow. */
  async getById(id: string): Promise<AccessRequest | null> {
    const rows = await execSpOne<AccessRequestRow>('usp_AccessRequest_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? rowToReq(rows[0]) : null;
  }

  async resolve(id: string, status: AccessRequestStatus, resolvedBy: string): Promise<AccessRequest | null> {
    const rows = await execSpOne<AccessRequestRow>('usp_AccessRequest_Resolve', [
      { name: 'Id',         type: sql.UniqueIdentifier, value: id },
      { name: 'Status',     type: sql.NVarChar(12),     value: status },
      { name: 'ResolvedBy', type: sql.UniqueIdentifier, value: resolvedBy },
    ]);
    return rows[0] ? rowToReq(rows[0]) : null;
  }

  /** Owner/admin recipient ids for the workspace owning the object (notification fan-out). */
  async listOwnerAdminIds(workspaceId: string): Promise<string[]> {
    const rows = await execSpOne<{ UserId: string }>('usp_Workspace_ListOwnerAdminIds', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as { UserId: string }[]).map((r) => r.UserId);
  }
}
