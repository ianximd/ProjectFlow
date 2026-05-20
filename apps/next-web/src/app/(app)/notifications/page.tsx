import { requireSession } from '@/server/session';
import { getNotifications } from '@/server/queries/notifications';
import { NotificationsView } from './notifications-view';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string }>;
}) {
  await requireSession();

  const sp        = await searchParams;
  const page      = Math.max(1, Number(sp.page ?? '1') || 1);
  const unreadOnly = sp.tab === 'unread';

  const { items, unreadCount } = await getNotifications({ page, unreadOnly });

  return (
    <NotificationsView
      items={items}
      unreadCount={unreadCount}
      page={page}
      unreadOnly={unreadOnly}
    />
  );
}
