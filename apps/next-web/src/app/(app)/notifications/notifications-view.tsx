'use client';

import { useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, BellOff, Check, CheckCheck, MessageSquare, UserPlus, AtSign,
  FileText, AlertCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { markNotificationRead, markAllNotificationsRead } from '@/server/actions/notifications';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { NotificationRow } from '@/server/queries/notifications';

// ── Type → icon + summary mapping ────────────────────────────────────────────

const TYPE_META: Record<string, {
  icon: typeof Bell;
  label: string;
  tone: 'blue' | 'amber' | 'emerald' | 'violet' | 'slate';
}> = {
  TASK_ASSIGNED: { icon: UserPlus,      label: 'Task assigned',      tone: 'blue'    },
  COMMENT_ADDED: { icon: MessageSquare, label: 'New comment',         tone: 'emerald' },
  MENTION:       { icon: AtSign,        label: 'You were mentioned',  tone: 'amber'   },
  TASK_UPDATED:  { icon: FileText,      label: 'Task updated',        tone: 'violet'  },
  TASK_DUE_SOON: { icon: AlertCircle,   label: 'Task due soon',       tone: 'amber'   },
};

const TONE_BG: Record<'blue' | 'amber' | 'emerald' | 'violet' | 'slate', string> = {
  blue:    'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  amber:   'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  violet:  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  slate:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { icon: Bell, label: humanize(type), tone: 'slate' as const };
}

function humanize(s: string) {
  return s.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// ── Relative time ─────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.round((Date.now() - t) / 1000);
  if (diff < 60)        return `${diff}s ago`;
  if (diff < 3600)      return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Root view
// ─────────────────────────────────────────────────────────────────────────────

export function NotificationsView({
  items,
  unreadCount,
  page,
  unreadOnly,
  pageSize,
}: {
  items: NotificationRow[];
  unreadCount: number;
  page: number;
  unreadOnly: boolean;
  pageSize: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // hasNextPage heuristic: if we filled the page, assume there is a next one.
  const hasNextPage = items.length === pageSize;

  // ── URL navigation helpers ────────────────────────────────────────────────
  function buildHref(opts: { tab?: string; page?: number }) {
    const params = new URLSearchParams();
    const tab  = opts.tab  ?? (unreadOnly ? 'unread' : 'all');
    const pg   = opts.page ?? page;
    if (tab !== 'all') params.set('tab', tab);
    if (pg  !== 1)     params.set('page', String(pg));
    const qs = params.toString();
    return `/notifications${qs ? `?${qs}` : ''}`;
  }

  function handleTabChange(value: string) {
    router.push(buildHref({ tab: value, page: 1 }));
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

  const activeTab = unreadOnly ? 'unread' : 'all';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Bell className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">Inbox</div>
          <h2 className="text-base font-semibold text-foreground truncate inline-flex items-center gap-2">
            Notifications
            {unreadCount > 0 && (
              <Badge variant="outline" size="xs" appearance="outline" className="bg-primary/10 text-primary border-primary/30">
                {unreadCount} unread
              </Badge>
            )}
          </h2>
        </div>
        <Button
          size="sm" variant="outline"
          onClick={handleMarkAllRead}
          disabled={isPending || unreadCount === 0}
        >
          <CheckCheck className="size-4" /> Mark all read
        </Button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5">All</TabsTrigger>
          <TabsTrigger value="unread" className="gap-1.5">
            Unread
            {unreadCount > 0 && (
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-3">
          <NotificationList
            rows={items}
            onMarkRead={handleMarkRead}
            markBusy={isPending}
            emptyTitle="You're all caught up"
            emptyBody="When teammates assign you tasks, comment on issues you reported, or mention you, those updates land here."
          />
        </TabsContent>
        <TabsContent value="unread" className="mt-3">
          <NotificationList
            rows={items}
            onMarkRead={handleMarkRead}
            markBusy={isPending}
            emptyTitle="Inbox zero"
            emptyBody="No unread notifications. Switch to All to see your history."
          />
        </TabsContent>
      </Tabs>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {(items.length > 0 || page > 1) && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Page {page}</span>
          <Button
            size="sm" variant="outline"
            disabled={page <= 1 || isPending}
            onClick={() => router.push(buildHref({ page: page - 1 }))}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={!hasNextPage || isPending}
            onClick={() => router.push(buildHref({ page: page + 1 }))}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification list (shared between tabs)
// ─────────────────────────────────────────────────────────────────────────────

function NotificationList({
  rows, onMarkRead, markBusy, emptyTitle, emptyBody,
}: {
  rows: NotificationRow[];
  onMarkRead: (id: string) => void;
  markBusy: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return (
    <Card className="p-0 overflow-hidden">
      <ul role="list" className="divide-y divide-border/60">
        {rows.map((n) => (
          <NotificationItem
            key={n.id}
            row={n}
            onMarkRead={() => onMarkRead(n.id)}
            markBusy={markBusy}
          />
        ))}
      </ul>
    </Card>
  );
}

function NotificationItem({
  row, onMarkRead, markBusy,
}: {
  row: NotificationRow;
  onMarkRead: () => void;
  markBusy: boolean;
}) {
  const meta = useMemo(() => typeMeta(row.type), [row.type]);
  const Icon = meta.icon;

  const taskTitle = row.payload?.taskTitle ?? null;
  const taskId    = row.payload?.taskId    ?? null;

  const summary = (() => {
    switch (row.type) {
      case 'TASK_ASSIGNED':
        return <>You were assigned to{' '}<strong className="text-foreground">{taskTitle ?? 'a task'}</strong>.</>;
      case 'COMMENT_ADDED':
        return <>A new comment was added on{' '}<strong className="text-foreground">{taskTitle ?? 'a task you follow'}</strong>.</>;
      case 'MENTION':
        return <>You were mentioned in{' '}<strong className="text-foreground">{taskTitle ?? 'a discussion'}</strong>.</>;
      case 'TASK_UPDATED':
        return <>An update was made to{' '}<strong className="text-foreground">{taskTitle ?? 'a task you follow'}</strong>.</>;
      case 'TASK_DUE_SOON':
        return <><strong className="text-foreground">{taskTitle ?? 'A task'}</strong> is due soon.</>;
      default:
        return <span className="text-muted-foreground">{meta.label}</span>;
    }
  })();

  // Link to the board with the task hash so a future handler can open the drawer.
  const taskHref = taskId ? `/board#task-${taskId}` : null;

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
          : <span className="block size-2 rounded-full bg-primary" title="Unread" />}
      </div>

      {/* Type icon */}
      <span className={cn('inline-flex size-8 items-center justify-center rounded-md shrink-0', TONE_BG[meta.tone])}>
        <Icon className="size-4" aria-hidden="true" />
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground leading-snug">{summary}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{meta.label}</span>
          <span aria-hidden="true">·</span>
          <span title={new Date(row.createdAt).toLocaleString()}>
            {timeAgo(row.createdAt)}
          </span>
          {taskHref && (
            <>
              <span aria-hidden="true">·</span>
              <a href={taskHref} className="text-primary hover:underline">Open task</a>
            </>
          )}
        </div>
      </div>

      {/* Mark-read affordance (only for unread rows) */}
      {!row.isRead && (
        <Button
          size="sm" variant="ghost"
          className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity h-7 px-2 text-xs shrink-0"
          onClick={onMarkRead}
          disabled={markBusy}
          aria-label="Mark as read"
        >
          <Check className="size-3.5" /> Mark read
        </Button>
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

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
