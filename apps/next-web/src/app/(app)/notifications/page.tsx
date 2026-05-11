'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, BellOff, Check, CheckCheck, MessageSquare, UserPlus, AtSign,
  FileText, AlertCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface NotificationRow {
  id:        string;
  userId:    string;
  type:      string;
  payload:   Record<string, any>;
  isRead:    boolean;
  createdAt: string;
}

// ── Type → icon + summary mapping ────────────────────────────────────────────

const TYPE_META: Record<string, {
  icon: typeof Bell;
  label: string;
  tone: 'blue' | 'amber' | 'emerald' | 'violet' | 'slate';
}> = {
  TASK_ASSIGNED:  { icon: UserPlus,      label: 'Task assigned',  tone: 'blue'    },
  COMMENT_ADDED:  { icon: MessageSquare, label: 'New comment',    tone: 'emerald' },
  MENTION:        { icon: AtSign,        label: 'You were mentioned', tone: 'amber' },
  TASK_UPDATED:   { icon: FileText,      label: 'Task updated',   tone: 'violet'  },
  TASK_DUE_SOON:  { icon: AlertCircle,   label: 'Task due soon',  tone: 'amber'   },
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

// "TASK_ASSIGNED" → "Task assigned"
function humanize(s: string) {
  return s.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// ── Relative time ────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.round((Date.now() - t) / 1000);
  if (diff < 60)       return `${diff}s ago`;
  if (diff < 3600)     return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400)    return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400*30) return `${Math.round(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── API helper ───────────────────────────────────────────────────────────────

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (res.status === 204) return { ok: res.ok, status: res.status, json: {} };
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

type View = 'all' | 'unread';

export default function NotificationsPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const [view, setView] = useState<View>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<{
    notifications: NotificationRow[];
    unreadCount:   number;
  }>({
    queryKey: ['notifications', view, page, accessToken],
    queryFn: async () => {
      const { status, ok, json } = await api(
        `/notifications?page=${page}&pageSize=${PAGE_SIZE}${view === 'unread' ? '&unreadOnly=true' : ''}`,
        accessToken,
      );
      if (status === 401) { router.push('/login'); return { notifications: [], unreadCount: 0 }; }
      return {
        notifications: ok ? (json.data ?? []) : [],
        unreadCount:   json?.meta?.unreadCount ?? 0,
      };
    },
  });

  const notifications = data?.notifications ?? [];
  const unreadCount   = data?.unreadCount   ?? 0;

  // We only get a page slice from the API plus a global unreadCount; assume
  // there's a next page if we filled the current one. (The backend doesn't
  // return a total, so this is the best signal we have.)
  const hasNextPage = notifications.length === PAGE_SIZE;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { ok } = await api(`/notifications/${id}/read`, accessToken, { method: 'PATCH' });
      if (!ok) throw new Error('Mark-read failed');
    },
    onSuccess: invalidate,
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const { ok } = await api('/notifications/mark-all-read', accessToken, { method: 'PATCH' });
      if (!ok) throw new Error('Mark-all-read failed');
    },
    onSuccess: invalidate,
  });

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
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending || unreadCount === 0}
        >
          <CheckCheck className="size-4" /> Mark all read
        </Button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs value={view} onValueChange={(v) => { setView(v as View); setPage(1); }}>
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

        <TabsContent value="all"    className="mt-3"><NotificationList
          isLoading={isLoading}
          rows={notifications}
          onMarkRead={(id) => markReadMutation.mutate(id)}
          markBusy={markReadMutation.isPending}
          emptyTitle="You're all caught up"
          emptyBody="When teammates assign you tasks, comment on issues you reported, or mention you, those updates land here."
        /></TabsContent>
        <TabsContent value="unread" className="mt-3"><NotificationList
          isLoading={isLoading}
          rows={notifications}
          onMarkRead={(id) => markReadMutation.mutate(id)}
          markBusy={markReadMutation.isPending}
          emptyTitle="Inbox zero"
          emptyBody="No unread notifications. Switch to All to see your history."
        /></TabsContent>
      </Tabs>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {(notifications.length > 0 || page > 1) && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Page {page}</span>
          <Button
            size="sm" variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isLoading}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNextPage || isLoading}
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
  isLoading, rows, onMarkRead, markBusy, emptyTitle, emptyBody,
}: {
  isLoading: boolean;
  rows: NotificationRow[];
  onMarkRead: (id: string) => void;
  markBusy: boolean;
  emptyTitle: string;
  emptyBody:  string;
}) {
  if (isLoading) return <ListSkeleton />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return (
    <Card className="p-0 overflow-hidden">
      <ul role="list" className="divide-y divide-border/60">
        {rows.map((n) => (
          <NotificationRow
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

function NotificationRow({
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

  // Default to a sensible per-type sentence; falls through to the raw type
  // name when we don't recognise it (forward-compatible with new notification
  // kinds the API might fire later).
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

  // We don't have a dedicated /tasks/:id page, but the board / drawer flow is
  // the natural destination. Pass the taskId in the URL hash so a future
  // handler on /board can auto-open the drawer.
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

      {/* Mark-read affordance */}
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
// Empty / loading
// ─────────────────────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <Card className="p-2 flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
    </Card>
  );
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
