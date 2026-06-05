'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSubscription } from '@apollo/client/react';
import {
  Bell, BellOff, Check, CheckCheck, ChevronLeft, ChevronRight, Bookmark, BookmarkCheck,
} from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { formatDateTime } from '@/lib/date';
import {
  markNotificationRead, markAllNotificationsRead, setNotificationSaved,
} from '@/server/actions/notifications';
import { NOTIFICATION_ADDED } from '@/lib/realtime/operations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { NotificationRow } from '@/server/queries/notifications';
import {
  TONE_BG, typeMeta, timeAgo, summaryFallbackKey, type InboxT,
} from '@/components/notifications/notification-meta';
import { INBOX_TAB_ORDER, type InboxTab } from './inbox-tabs';

const TAB_LABEL_KEY: Record<InboxTab, string> = {
  all:      'tabAll',
  unread:   'tabUnread',
  assigned: 'tabAssigned',
  mentions: 'tabMentions',
  comments: 'tabComments',
  saved:    'tabSaved',
};

// ── Live subscription mapping ────────────────────────────────────────────────
// The NOTIFICATION_ADDED payload carries only { id, type, isRead, createdAt }.
// Map it to a minimal NotificationRow; the enriched row (payload, savedForLater)
// replaces it on the next SSR refresh.
function mapLiveNotification(n: {
  id: string; type: string; isRead: boolean; createdAt: string;
}): NotificationRow {
  return {
    id: n.id,
    userId: '',
    type: n.type,
    payload: {},
    isRead: n.isRead,
    savedForLater: false,
    createdAt: n.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Root view
// ─────────────────────────────────────────────────────────────────────────────

export function NotificationsView({
  items: initialItems,
  unreadCount,
  page,
  activeTab,
  pageSize,
}: {
  items: NotificationRow[];
  unreadCount: number;
  page: number;
  activeTab: InboxTab;
  pageSize: number;
}) {
  const t = useTranslations('Inbox');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // SSR remains the base. Live deltas prepend client-side; re-seed when the
  // server data changes (tab/page navigation or revalidation).
  const [items, setItems] = useState<NotificationRow[]>(initialItems);
  useEffect(() => { setItems(initialItems); }, [initialItems]);

  useSubscription<{
    notificationAdded: { id: string; type: string; isRead: boolean; createdAt: string };
  }>(NOTIFICATION_ADDED, {
    onData: ({ data }) => {
      const n = data.data?.notificationAdded;
      if (!n) return;
      setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [mapLiveNotification(n), ...prev]));
    },
  });

  // hasNextPage heuristic: if we filled the page, assume there is a next one.
  const hasNextPage = items.length === pageSize;

  // ── URL navigation helpers ────────────────────────────────────────────────
  function buildHref(opts: { tab?: InboxTab; page?: number }) {
    const params = new URLSearchParams();
    const tab = opts.tab  ?? activeTab;
    const pg  = opts.page ?? page;
    if (tab !== 'all') params.set('tab', tab);
    if (pg  !== 1)     params.set('page', String(pg));
    const qs = params.toString();
    return `/notifications${qs ? `?${qs}` : ''}`;
  }

  function handleTabChange(value: string) {
    router.push(buildHref({ tab: value as InboxTab, page: 1 }));
  }

  // ── Server action handlers ────────────────────────────────────────────────
  function handleMarkRead(id: string) {
    startTransition(async () => {
      const res = await markNotificationRead(id);
      if (!res.ok) notifyActionError(res);
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      const res = await markAllNotificationsRead();
      if (!res.ok) notifyActionError(res);
    });
  }

  function handleToggleSaved(id: string, next: boolean) {
    // Optimistic flip; revert on failure.
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, savedForLater: next } : x)));
    startTransition(async () => {
      const res = await setNotificationSaved(id, next);
      if (!res.ok) {
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, savedForLater: !next } : x)));
        notifyActionError(res);
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Bell className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{t('title')}</div>
          <h2 className="text-base font-semibold text-foreground truncate inline-flex items-center gap-2">
            {t('heading')}
            {unreadCount > 0 && (
              <Badge variant="outline" size="xs" appearance="outline" className="bg-primary/10 text-primary border-primary/30">
                {t('unreadBadge', { count: unreadCount })}
              </Badge>
            )}
          </h2>
        </div>
        <Button
          size="sm" variant="outline"
          onClick={handleMarkAllRead}
          disabled={isPending || unreadCount === 0}
        >
          <CheckCheck className="size-4" /> {t('markAllRead')}
        </Button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {INBOX_TAB_ORDER.map((tab) => (
            <TabsTrigger key={tab} value={tab} className="gap-1.5">
              {t(TAB_LABEL_KEY[tab])}
              {tab === 'unread' && unreadCount > 0 && (
                <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-3">
          <NotificationList
            rows={items}
            onMarkRead={handleMarkRead}
            onToggleSaved={handleToggleSaved}
            markBusy={isPending}
            activeTab={activeTab}
            t={t}
          />
        </TabsContent>
      </Tabs>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {(items.length > 0 || page > 1) && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>{t('page', { page })}</span>
          <Button
            size="sm" variant="outline"
            disabled={page <= 1 || isPending}
            onClick={() => router.push(buildHref({ page: page - 1 }))}
          >
            <ChevronLeft className="size-3.5" /> {t('prev')}
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={!hasNextPage || isPending}
            onClick={() => router.push(buildHref({ page: page + 1 }))}
          >
            {t('next')} <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification list
// ─────────────────────────────────────────────────────────────────────────────

function NotificationList({
  rows, onMarkRead, onToggleSaved, markBusy, activeTab, t,
}: {
  rows: NotificationRow[];
  onMarkRead: (id: string) => void;
  onToggleSaved: (id: string, next: boolean) => void;
  markBusy: boolean;
  activeTab: InboxTab;
  t: InboxT;
}) {
  if (rows.length === 0) {
    const titleKey = `empty_${activeTab}_title` as const;
    const bodyKey  = `empty_${activeTab}_body` as const;
    return <EmptyState title={t(titleKey)} body={t(bodyKey)} />;
  }
  return (
    <Card className="p-0 overflow-hidden">
      <ul role="list" className="divide-y divide-border/60">
        {rows.map((n) => (
          <NotificationItem
            key={n.id}
            row={n}
            onMarkRead={() => onMarkRead(n.id)}
            onToggleSaved={() => onToggleSaved(n.id, !n.savedForLater)}
            markBusy={markBusy}
            t={t}
          />
        ))}
      </ul>
    </Card>
  );
}

function NotificationItem({
  row, onMarkRead, onToggleSaved, markBusy, t,
}: {
  row: NotificationRow;
  onMarkRead: () => void;
  onToggleSaved: () => void;
  markBusy: boolean;
  t: InboxT;
}) {
  const meta = useMemo(() => typeMeta(row.type), [row.type]);
  const Icon = meta.icon;

  const taskTitle: string | null = row.payload?.taskTitle ?? null;
  const taskId: string | null    = row.payload?.taskId    ?? null;

  // Localized type label (fall back to a humanized enum for unknown types).
  const label = meta.labelKey ? t(meta.labelKey) : humanize(row.type);

  // Localized summary via t.rich — bolds the (possibly fallback) task title.
  const summary: ReactNode = meta.summaryKey
    ? t.rich(meta.summaryKey, {
        title: taskTitle ?? t(summaryFallbackKey(row.type)),
        b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
      })
    : <span className="text-muted-foreground">{label}</span>;

  // Link to the board with the task hash so a future handler can open the drawer.
  const taskHref = taskId ? `/board#task-${taskId}` : null;
  const saved = row.savedForLater === true;

  return (
    <li
      className={cn(
        'group flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors',
        !row.isRead && 'bg-primary/5',
      )}
    >
      {/* Unread dot rail */}
      <div className="pt-1 shrink-0" aria-hidden="true">
        {row.isRead
          ? <span className="block size-2 rounded-full opacity-0" />
          : <span className="block size-2 rounded-full bg-primary" title={t('unreadDot')} />}
      </div>

      {/* Type icon */}
      <span className={cn('inline-flex size-8 items-center justify-center rounded-md shrink-0', TONE_BG[meta.tone])}>
        <Icon className="size-4" aria-hidden="true" />
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground leading-snug">{summary}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{label}</span>
          <span aria-hidden="true">·</span>
          <span title={formatDateTime(row.createdAt)}>
            {timeAgo(row.createdAt, t)}
          </span>
          {taskHref && (
            <>
              <span aria-hidden="true">·</span>
              <a href={taskHref} className="text-primary hover:underline">{t('openTask')}</a>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm" variant="ghost"
          className={cn(
            'h-7 px-2 text-xs transition-opacity',
            saved ? 'text-primary' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
          onClick={onToggleSaved}
          disabled={markBusy}
          aria-label={saved ? t('unsave') : t('save')}
          title={saved ? t('unsave') : t('save')}
        >
          {saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
          {saved ? t('unsave') : t('save')}
        </Button>

        {/* Mark-read affordance (only for unread rows) */}
        {!row.isRead && (
          <Button
            size="sm" variant="ghost"
            className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity h-7 px-2 text-xs"
            onClick={onMarkRead}
            disabled={markBusy}
            aria-label={t('markRead')}
          >
            <Check className="size-3.5" /> {t('markRead')}
          </Button>
        )}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers + empty state
// ─────────────────────────────────────────────────────────────────────────────

function humanize(s: string) {
  return s.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <BellOff className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground max-w-md">{body}</div>
      </div>
    </div>
  );
}
