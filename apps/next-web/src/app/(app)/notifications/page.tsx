import { requireSession } from '@/server/session';
import { getNotifications, NOTIFICATIONS_PAGE_SIZE } from '@/server/queries/notifications';
import { INBOX_TABS, isInboxTab } from './inbox-tabs';
import { NotificationsView } from './notifications-view';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string }>;
}) {
  await requireSession();

  const sp   = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const tab  = isInboxTab(sp.tab) ? sp.tab : 'all';

  const { items, unreadCount } = await getNotifications({
    ...INBOX_TABS[tab],
    page,
    pageSize: NOTIFICATIONS_PAGE_SIZE,
  });

  return (
    <NotificationsView
      items={items}
      unreadCount={unreadCount}
      page={page}
      activeTab={tab}
      pageSize={NOTIFICATIONS_PAGE_SIZE}
    />
  );
}
