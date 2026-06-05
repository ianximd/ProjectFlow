'use client';

import { ReactNode, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BellOff, CheckCheck, ChevronRight } from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { formatDateTime } from '@/lib/date';
import { markAllNotificationsRead } from '@/server/actions/notifications';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  TONE_BG, typeMeta, timeAgo, summaryFallbackKey, type InboxT,
} from '@/components/notifications/notification-meta';
import type { NotificationRow } from '@/server/queries/notifications';

// ── Topbar dropdown preview ──────────────────────────────────────────────────
// A COMPACT, read-only preview of the most recent notifications (seeded by the
// single SSR `getNotifications({ pageSize: 8 })` fetch in `(app)/layout.tsx`,
// threaded via the layout context — no client-side fetch here). The full
// affordances (mark-read/save per row, pagination, tabs) live on /notifications.

export function NotificationsSheet({
  trigger,
  notifications,
}: {
  trigger: ReactNode;
  notifications: NotificationRow[];
}) {
  const t = useTranslations('Inbox');
  const [isPending, startTransition] = useTransition();

  function handleMarkAllRead() {
    startTransition(async () => {
      const res = await markAllNotificationsRead();
      if (!res.ok) notifyActionError(res);
    });
  }

  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="gap-0 sm:w-[440px] inset-5 start-auto h-auto rounded-lg p-0 sm:max-w-none [&_[data-slot=sheet-close]]:top-4.5 [&_[data-slot=sheet-close]]:end-5">
        <SheetHeader className="mb-0 flex-row items-center justify-between gap-2 border-b border-border p-4 pe-12">
          <SheetTitle className="p-0">{t('heading')}</SheetTitle>
          {hasUnread && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleMarkAllRead}
              disabled={isPending}
            >
              <CheckCheck className="size-3.5" /> {t('markAllRead')}
            </Button>
          )}
        </SheetHeader>
        <SheetBody className="grow p-0">
          <ScrollArea className="h-[calc(100vh-12rem)]">
            {notifications.length === 0 ? (
              <EmptyPreview label={t('empty')} />
            ) : (
              <ul role="list" className="divide-y divide-border/60">
                {notifications.map((n) => (
                  <PreviewRow key={n.id} row={n} t={t} />
                ))}
              </ul>
            )}
          </ScrollArea>
        </SheetBody>
        <SheetFooter className="border-t border-border p-4">
          <SheetClose asChild>
            <Button asChild variant="outline" className="w-full">
              <Link href="/notifications">
                {t('seeAll')} <ChevronRight className="size-3.5" />
              </Link>
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── Compact row ──────────────────────────────────────────────────────────────

function PreviewRow({ row, t }: { row: NotificationRow; t: InboxT }) {
  const meta = typeMeta(row.type);
  const Icon = meta.icon;

  const taskTitle: string | null = row.payload?.taskTitle ?? null;
  const taskId: string | null    = row.payload?.taskId    ?? null;

  const label = meta.labelKey ? t(meta.labelKey) : humanize(row.type);

  // Compact one-line summary; bolds the (possibly fallback) task title.
  const summary: ReactNode = meta.summaryKey
    ? t.rich(meta.summaryKey, {
        title: taskTitle ?? t(summaryFallbackKey(row.type)),
        b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
      })
    : <span className="text-muted-foreground">{label}</span>;

  // Navigating to the board (or the full Inbox) closes the sheet.
  const href = taskId ? `/board#task-${taskId}` : '/notifications';

  return (
    <li className={cn('transition-colors hover:bg-muted/20', !row.isRead && 'bg-primary/5')}>
      <SheetClose asChild>
        <Link href={href} className="flex items-start gap-3 px-4 py-3">
          {/* Unread dot rail */}
          <span className="pt-1 shrink-0" aria-hidden="true">
            {row.isRead
              ? <span className="block size-2 rounded-full opacity-0" />
              : <span className="block size-2 rounded-full bg-primary" title={t('unreadDot')} />}
          </span>

          {/* Type icon */}
          <span className={cn('inline-flex size-8 items-center justify-center rounded-md shrink-0', TONE_BG[meta.tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>

          {/* Body */}
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-foreground leading-snug line-clamp-2">{summary}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{label}</span>
              <span aria-hidden="true">·</span>
              <span title={formatDateTime(row.createdAt)}>{timeAgo(row.createdAt, t)}</span>
            </span>
          </span>
        </Link>
      </SheetClose>
    </li>
  );
}

function EmptyPreview({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <BellOff className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="text-sm font-medium text-foreground">{label}</div>
    </div>
  );
}

function humanize(s: string) {
  return s.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
