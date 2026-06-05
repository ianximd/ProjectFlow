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

/**
 * Whether a live `notificationAdded` delta belongs in the currently-active tab.
 * Mirrors the server-side filter (`INBOX_TABS`) so client-side live prepends
 * don't leak rows the active filter would have excluded (e.g. a read item onto
 * Unread, or any item onto a type-scoped tab it doesn't match). A freshly
 * arrived notification can never be saved-for-later, so the Saved tab matches
 * nothing live — it re-seeds from SSR on navigation instead.
 */
export function matchesInboxTab(
  tab: InboxTab,
  n: { type: string; isRead: boolean },
): boolean {
  const f = INBOX_TABS[tab] as {
    unreadOnly?: boolean;
    types?: readonly string[];
    savedOnly?: boolean;
  };
  if (f.savedOnly) return false;
  if (f.unreadOnly && n.isRead) return false;
  if (f.types && !f.types.includes(n.type)) return false;
  return true;
}
