import 'server-only';
import { cache } from 'react';
import { serverFetchEnvelope } from '../api';

// The API service layer normalises the DB PascalCase row (Id, UserId, Type,
// Payload, IsRead, CreatedAt) into camelCase before sending — so the wire
// shape is already camelCase.
export interface NotificationRow {
  id:        string;
  userId:    string;
  type:      string;
  payload:   Record<string, any>;
  isRead:    boolean;
  createdAt: string; // ISO string on the wire (Date serialised by JSON.stringify)
}

export const getNotifications = cache(async (
  opts: { page?: number; pageSize?: number; unreadOnly?: boolean } = {},
): Promise<{ items: NotificationRow[]; unreadCount: number; page: number }> => {
  const page     = opts.page     ?? 1;
  const pageSize = opts.pageSize ?? 20;

  const qs = new URLSearchParams({
    page:     String(page),
    pageSize: String(pageSize),
  });
  if (opts.unreadOnly) qs.set('unreadOnly', 'true');

  const { data, meta } = await serverFetchEnvelope<NotificationRow[], { unreadCount?: number }>(
    `/notifications?${qs}`,
  );

  return {
    items:       data ?? [],
    unreadCount: meta?.unreadCount ?? 0,
    page,
  };
});
