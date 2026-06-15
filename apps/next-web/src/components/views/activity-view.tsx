'use client';

import { useState, useEffect } from 'react';
import { useSubscription } from '@apollo/client/react';
import { useTranslations } from 'next-intl';
import { TASK_EVENTS } from '@/lib/realtime/operations';
import { taskEventToEntry, prependEntry } from '@/lib/activity/activity-entry';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { AuditLogPage, AuditLogEntry } from '@projectflow/types';
import type { TaskEvent } from '@/lib/realtime/apply-task-event';

interface Props {
  activityPage: AuditLogPage | null;
  live: LiveScopeProp;
}

/** Format a createdAt ISO string into a compact, locale-independent display. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Reverse-chronological AuditLogEntry feed for Activity views.
 *  SSR-seeded from `activityPage`, then live-prepended from the TASK_EVENTS
 *  subscription as new events arrive — no SSR re-seed required for low-volume
 *  activity streams. */
export function ActivityView({ activityPage, live }: Props) {
  const t = useTranslations('Activity');

  const [entries, setEntries] = useState<AuditLogEntry[]>(
    () => activityPage?.entries ?? [],
  );

  // Re-seed when the SSR prop changes (navigation or router.refresh).
  useEffect(() => {
    setEntries(activityPage?.entries ?? []);
  }, [activityPage]);

  // Actor and action filter (client-side, over the already-loaded page).
  const [actorFilter, setActorFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');

  // Live prepend from the task-events subscription.
  const projectId  = live.projectId  ?? null;
  const workspaceId = live.workspaceId ?? null;
  const enabled = Boolean(projectId || workspaceId);

  useSubscription<{ taskEvents: TaskEvent }>(TASK_EVENTS, {
    variables: { projectId, workspaceId },
    skip: !enabled,
    onData: ({ data }) => {
      const ev = data.data?.taskEvents;
      if (!ev) return;
      const entry = taskEventToEntry(ev);
      if (!entry) return;
      setEntries((prev) => prependEntry(prev, entry));
    },
  });

  // Derive unique actors + actions for the filter dropdowns.
  const actors = Array.from(new Set(entries.map((e) => e.userId).filter(Boolean)));
  const actions = Array.from(new Set(entries.map((e) => e.action).filter(Boolean)));

  const visible = entries.filter((e) => {
    if (actorFilter && e.userId !== actorFilter) return false;
    if (actionFilter && e.action !== actionFilter) return false;
    return true;
  });

  return (
    <div data-testid="view-body-activity" className="flex h-full flex-col overflow-auto rounded-lg border border-border bg-background">
      {/* Filters */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <select
          data-testid="activity-filter-actor"
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          aria-label={t('filterActor')}
        >
          <option value="">{t('allActors')}</option>
          {actors.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          data-testid="activity-filter-action"
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          aria-label={t('filterAction')}
        >
          <option value="">{t('allActions')}</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Feed — reverse-chronological (newest first, already from API) */}
      {visible.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t('empty')}</div>
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map((entry) => (
            <li
              key={entry.id}
              data-testid="activity-entry"
              data-action={entry.action}
              data-resource={entry.resource}
              className="flex items-start gap-3 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{entry.userEmail ?? entry.userId}</span>
                  <span>{entry.action.toLowerCase()}d</span>
                  <span className="font-medium text-foreground">{entry.resource}</span>
                  {entry.resourceId && (
                    <span className="truncate text-muted-foreground/70">{entry.resourceId}</span>
                  )}
                </div>
                <time
                  className="text-[11px] text-muted-foreground/60"
                  dateTime={entry.createdAt}
                >
                  {formatDate(entry.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
