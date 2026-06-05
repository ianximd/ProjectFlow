'use client';

import { useState } from 'react';
import { useSubscription } from '@apollo/client/react';
import { Bell } from 'lucide-react';
import { NOTIFICATION_ADDED } from '@/lib/realtime/operations';

/** Server-seeded unread badge that increments live on `notificationAdded`.
 *  Pure local counter over the SSR `initialUnread`; re-seeds on next navigation. */
export function NotificationBell({
  initialUnread,
  children,
}: {
  initialUnread: number;
  children?: React.ReactNode;
}) {
  const [unread, setUnread] = useState(initialUnread);

  useSubscription<{ notificationAdded: { id: string } }>(NOTIFICATION_ADDED, {
    onData: () => setUnread((n) => n + 1),
  });

  return (
    <span className="relative inline-flex">
      {children ?? <Bell className="size-4.5" />}
      {unread > 0 && (
        <span
          aria-label={`${unread} unread notifications`}
          className="absolute -right-1 -top-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 text-destructive-foreground"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </span>
  );
}
