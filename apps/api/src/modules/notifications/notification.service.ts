import { NotificationRepository } from './notification.repository.js';
import type { NotificationRow } from './notification.repository.js';

const repo = new NotificationRepository();

export interface ParsedNotification {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, any>;
  isRead: boolean;
  createdAt: Date;
}

function parse(row: NotificationRow): ParsedNotification {
  return {
    id:        row.Id,
    userId:    row.UserId,
    type:      row.Type,
    payload:   JSON.parse(row.Payload),
    isRead:    Boolean(row.IsRead),
    createdAt: row.CreatedAt,
  };
}

export const notificationService = {
  /**
   * Fan-out: create one notification per recipient.
   * Ignores recipients that equal actorId (no self-notifications).
   */
  async notify(params: {
    recipientIds: string[];
    actorId: string;
    type: string;
    payload: Record<string, any>;
  }): Promise<void> {
    const unique = [...new Set(params.recipientIds)].filter(
      (id) => id !== params.actorId,
    );
    await Promise.allSettled(
      unique.map((userId) =>
        repo.create(userId, params.type, {
          ...params.payload,
          actorId: params.actorId,
        }),
      ),
    );
  },

  async list(userId: string, page: number, pageSize: number, unreadOnly: boolean) {
    const { notifications, unreadCount } = await repo.list(userId, page, pageSize, unreadOnly);
    return {
      notifications: notifications.map(parse),
      unreadCount,
    };
  },

  async markRead(id: string, userId: string): Promise<void> {
    await repo.markRead(id, userId);
  },

  async markAllRead(userId: string): Promise<number> {
    return repo.markAllRead(userId);
  },
};
