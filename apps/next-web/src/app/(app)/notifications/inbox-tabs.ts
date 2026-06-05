// Inbox tab definitions: each tab maps to a server-side notification filter.
// `getNotifications` understands { unreadOnly, types, savedOnly }.
export const INBOX_TABS = {
  all:      {},
  unread:   { unreadOnly: true },
  assigned: { types: ['COMMENT_ASSIGNED', 'TASK_ASSIGNED'] },
  mentions: { types: ['MENTION'] },
  comments: { types: ['COMMENT_ADDED', 'COMMENT_ASSIGNED'] },
  saved:    { savedOnly: true },
} as const;

export type InboxTab = keyof typeof INBOX_TABS;

export const INBOX_TAB_ORDER: InboxTab[] = ['all', 'unread', 'assigned', 'mentions', 'comments', 'saved'];

export function isInboxTab(value: string | undefined): value is InboxTab {
  return value != null && Object.prototype.hasOwnProperty.call(INBOX_TABS, value);
}
