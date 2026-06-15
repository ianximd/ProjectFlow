import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { ShareLink, ShareObjectType } from '@projectflow/types';

interface ShareLinkRow {
  Id: string; WorkspaceId: string; ObjectType: ShareObjectType; ObjectId: string;
  Token: string; Level: ShareLink['level']; ExpiresAt: Date | null;
  CreatedBy: string; CreatedAt: Date; RevokedAt: Date | null;
}

function toIso(d: Date | null): string | null {
  return d ? (d instanceof Date ? d.toISOString() : String(d)) : null;
}

function rowToLink(r: ShareLinkRow): ShareLink {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, objectType: r.ObjectType, objectId: r.ObjectId,
    token: r.Token, level: r.Level, expiresAt: toIso(r.ExpiresAt), createdBy: r.CreatedBy,
    createdAt: r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
    revokedAt: toIso(r.RevokedAt),
  };
}

export class ShareRepository {
  async create(p: {
    workspaceId: string; objectType: ShareObjectType; objectId: string;
    token: string; level: string; expiresAt: string | null; createdBy: string;
  }): Promise<ShareLink> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ObjectType',  type: sql.NVarChar(16),     value: p.objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: p.objectId },
      { name: 'Token',       type: sql.NVarChar(64),     value: p.token },
      { name: 'Level',       type: sql.NVarChar(8),      value: p.level },
      { name: 'ExpiresAt',   type: sql.DateTime2,        value: p.expiresAt ? new Date(p.expiresAt) : null },
      { name: 'CreatedBy',   type: sql.UniqueIdentifier, value: p.createdBy },
    ]);
    return rowToLink(rows[0]);
  }

  /** Live-only resolution — the SP filters revoked/expired (zero rows if dead). */
  async resolve(token: string): Promise<ShareLink | null> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_Resolve', [
      { name: 'Token', type: sql.NVarChar(64), value: token },
    ]);
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  /** Non-mutating read for the authorize-then-mutate revoke flow. */
  async getById(id: string): Promise<ShareLink | null> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  async revoke(id: string): Promise<ShareLink | null> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_Revoke', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  async listForObject(objectType: ShareObjectType, objectId: string): Promise<ShareLink[]> {
    const rows = await execSpOne<ShareLinkRow>('usp_ShareLink_ListForObject', [
      { name: 'ObjectType', type: sql.NVarChar(16),     value: objectType },
      { name: 'ObjectId',   type: sql.UniqueIdentifier, value: objectId },
    ]);
    return (rows as ShareLinkRow[]).map(rowToLink);
  }
}
