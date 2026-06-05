import { NotificationRepository } from './notification.repository.js';
import type { NotificationRow } from './notification.repository.js';
import { pubsub } from '../../graphql/pubsub.js';

const repo = new NotificationRepository();

export interface ParsedNotification {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, any>;
  isRead: boolean;
  savedForLater: boolean;
  savedAt: Date | null;
  createdAt: Date;
}

function parse(row: NotificationRow): ParsedNotification {
  return {
    id:           row.Id,
    userId:       row.UserId,
    type:         row.Type,
    payload:      JSON.parse(row.Payload),
    isRead:       Boolean(row.IsRead),
    savedForLater: Boolean(row.SavedForLater),
    savedAt:      row.SavedAt ?? null,
    createdAt:    row.CreatedAt,
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
    const tasks = unique.map(async (userId) => {
      const row = await repo.create(userId, params.type, {
        ...params.payload,
        actorId: params.actorId,
      });
      try {
        // Normalize the GUID case: the pubsub topic key is a case-SENSITIVE
        // string, but recipient ids reach here in mixed case (the mention parser
        // lowercases; DB-sourced ids are upper). The subscriber keys off the
        // JWT's userId, so both sides must agree — lowercase is the canonical form.
        pubsub.publish('notification:added', userId.toLowerCase(), { notification: parse(row) });
      } catch {
        /* best-effort */
      }
    });
    await Promise.allSettled(tasks);
  },

  async list(userId: string, page: number, pageSize: number, unreadOnly: boolean, types?: string[], savedOnly = false) {
    const { notifications, unreadCount } = await repo.list(userId, page, pageSize, unreadOnly, types, savedOnly);
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

  async setSaved(id: string, userId: string, saved: boolean): Promise<void> {
    await repo.setSaved(id, userId, saved);
  },
};
