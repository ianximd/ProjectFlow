import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';

export interface NotificationRow {
  Id: string;
  UserId: string;
  Type: string;
  Payload: string; // raw JSON string
  IsRead: boolean;
  SavedForLater: boolean;
  SavedAt: Date | null;
  CreatedAt: Date;
}

export class NotificationRepository {
  async create(userId: string, type: string, payload: object): Promise<NotificationRow> {
    const rows = await execSpOne<NotificationRow>('usp_Notification_Create', [
      { name: 'UserId',  type: sql.UniqueIdentifier,  value: userId },
      { name: 'Type',    type: sql.NVarChar(50),       value: type },
      { name: 'Payload', type: sql.NVarChar(sql.MAX),  value: JSON.stringify(payload) },
    ]);
    return rows[0];
  }

  async list(userId: string, page = 1, pageSize = 20, unreadOnly = false, types?: string[], savedOnly = false) {
    const sets = await execSp('usp_Notification_List', [
      { name: 'UserId',     type: sql.UniqueIdentifier,  value: userId },
      { name: 'Page',       type: sql.Int,               value: page },
      { name: 'PageSize',   type: sql.Int,               value: pageSize },
      { name: 'UnreadOnly', type: sql.Bit,               value: unreadOnly ? 1 : 0 },
      { name: 'Types',      type: sql.NVarChar(sql.MAX), value: types && types.length ? types.join(',') : null },
      { name: 'SavedOnly',  type: sql.Bit,               value: savedOnly ? 1 : 0 },
    ]);
    const notifications = sets[0] as NotificationRow[];
    const unreadCount   = (sets[1]?.[0] as any)?.UnreadCount ?? 0;
    return { notifications, unreadCount };
  }

  async setSaved(id: string, userId: string, saved: boolean): Promise<void> {
    await execSpOne('usp_Notification_SetSaved', [
      { name: 'Id',     type: sql.UniqueIdentifier, value: id },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
      { name: 'Saved',  type: sql.Bit,              value: saved ? 1 : 0 },
    ]);
  }

  async markRead(id: string, userId: string): Promise<void> {
    await execSpOne('usp_Notification_MarkRead', [
      { name: 'Id',     type: sql.UniqueIdentifier, value: id },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await execSpOne<{ UpdatedCount: number }>('usp_Notification_MarkAllRead', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows[0]?.UpdatedCount ?? 0;
  }
}
