import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { GuestInvite, Guest, GuestGrant, HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import type { GuestRoleSlug } from './guest.pure.js';

function isoOrNull(v: Date | string | null): string | null {
  return v == null ? null : v instanceof Date ? v.toISOString() : String(v);
}

interface InviteRow {
  Id: string; WorkspaceId: string; Email: string; ObjectType: HierarchyNodeType; ObjectId: string;
  Level: ObjectPermissionLevel; Token: string; Status: GuestInvite['status']; InvitedBy: string;
  ExpiresAt: Date | null; CreatedAt: Date; AcceptedAt: Date | null;
}
function rowToInvite(r: InviteRow): GuestInvite {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, email: r.Email, objectType: r.ObjectType, objectId: r.ObjectId,
    level: r.Level, token: r.Token, status: r.Status, invitedBy: r.InvitedBy,
    expiresAt: isoOrNull(r.ExpiresAt), createdAt: isoOrNull(r.CreatedAt)!, acceptedAt: isoOrNull(r.AcceptedAt),
  };
}

// usp_GuestInvite_List result-set 1: one row per (guest, grant); a guest with no
// grant has NULL Object* columns (LEFT JOIN). RoleSlug is computed in the SP.
interface GuestListRow {
  UserId: string; Email: string; Name: string; AvatarUrl: string | null;
  RoleSlug: GuestRoleSlug;
  ObjectType: HierarchyNodeType | null; ObjectId: string | null; Level: ObjectPermissionLevel | null;
}

export class GuestRepository {
  async createInvite(args: {
    workspaceId: string; email: string; objectType: HierarchyNodeType; objectId: string;
    level: ObjectPermissionLevel; token: string; invitedBy: string; expiresAt: string | null;
  }): Promise<GuestInvite> {
    const rows = await execSpOne<InviteRow>('usp_GuestInvite_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: args.workspaceId },
      { name: 'Email',       type: sql.NVarChar(255),    value: args.email },
      { name: 'ObjectType',  type: sql.NVarChar(8),      value: args.objectType },
      { name: 'ObjectId',    type: sql.UniqueIdentifier, value: args.objectId },
      { name: 'Level',       type: sql.NVarChar(8),      value: args.level },
      { name: 'Token',       type: sql.NVarChar(64),     value: args.token },
      { name: 'InvitedBy',   type: sql.UniqueIdentifier, value: args.invitedBy },
      { name: 'ExpiresAt',   type: sql.DateTime2,        value: args.expiresAt ? new Date(args.expiresAt) : null },
    ]);
    return rowToInvite(rows[0]);
  }

  async findByToken(token: string): Promise<GuestInvite | null> {
    const rows = await execSpOne<InviteRow>('usp_GuestInvite_GetByToken', [
      { name: 'Token', type: sql.NVarChar(64), value: token },
    ]);
    return rows[0] ? rowToInvite(rows[0]) : null;
  }

  async acceptInvite(token: string, accepterUserId: string, roleSlug: GuestRoleSlug): Promise<{
    id: string; workspaceId: string; objectType: HierarchyNodeType; objectId: string; userId: string;
  }> {
    const rows = await execSpOne<{
      Id: string; WorkspaceId: string; ObjectType: HierarchyNodeType; ObjectId: string; UserId: string;
    }>('usp_GuestInvite_Accept', [
      { name: 'Token',          type: sql.NVarChar(64),     value: token },
      { name: 'AccepterUserId', type: sql.UniqueIdentifier, value: accepterUserId },
      { name: 'RoleSlug',       type: sql.NVarChar(100),    value: roleSlug },
    ]);
    const r = rows[0];
    return { id: r.Id, workspaceId: r.WorkspaceId, objectType: r.ObjectType, objectId: r.ObjectId, userId: r.UserId };
  }

  async listGuests(workspaceId: string): Promise<{ guests: Guest[]; pending: GuestInvite[] }> {
    // execSp returns IRecordSet<T>[] directly: sets[0]=guest+grant rows, sets[1]=pending invites.
    const sets = await execSp<GuestListRow | InviteRow>('usp_GuestInvite_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    const guestRows = (sets[0] ?? []) as GuestListRow[];
    const pendingRows = (sets[1] ?? []) as InviteRow[];

    const byUser = new Map<string, Guest>();
    for (const row of guestRows) {
      let g = byUser.get(row.UserId);
      if (!g) {
        g = { userId: row.UserId, email: row.Email, name: row.Name, avatarUrl: row.AvatarUrl, roleSlug: row.RoleSlug, grants: [] };
        byUser.set(row.UserId, g);
      }
      if (row.ObjectId) g.grants.push({ objectType: row.ObjectType!, objectId: row.ObjectId, level: row.Level! });
    }
    return { guests: [...byUser.values()], pending: pendingRows.map(rowToInvite) };
  }

  async revokeGuest(workspaceId: string, opts: { userId?: string; inviteId?: string }): Promise<void> {
    await execSpOne('usp_GuestInvite_Revoke', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: opts.userId ?? null },
      { name: 'InviteId',    type: sql.UniqueIdentifier, value: opts.inviteId ?? null },
    ]);
  }
}
