'use client';

import { useEffect, useState, useTransition } from 'react';
import type { MemberRow } from '@/server/queries/workspace';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { loadWorkspaceMembers } from '@/server/actions/members';
import { loadTaskWatchers, addWatcher, removeWatcher } from '@/server/actions/watchers';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';

/**
 * Watcher control for the task drawer. Lists current watchers and lets the user
 * toggle any workspace member as a watcher. Optimistic with rollback.
 */
export function WatcherControl({ taskId, workspaceId }: { taskId: string; workspaceId: string }) {
  const t = useTranslations('Task');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [watcherIds, setWatcherIds] = useState<Set<string>>(new Set());
  const [, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorkspaceMembers(workspaceId), loadTaskWatchers(taskId)])
      .then(([ms, ws]) => {
        if (cancelled) return;
        setMembers(ms);
        setWatcherIds(new Set(ws.map((w) => w.userId.toUpperCase())));
      })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, [taskId, workspaceId]);

  function toggle(userId: string) {
    const key = userId.toUpperCase();
    const watching = watcherIds.has(key);
    const next = new Set(watcherIds);
    if (watching) next.delete(key); else next.add(key);
    setWatcherIds(next); // optimistic
    start(async () => {
      const r = watching ? await removeWatcher(taskId, userId) : await addWatcher(taskId, userId);
      if (!r.ok) {
        setWatcherIds((prev) => {
          const rb = new Set(prev);
          if (watching) rb.add(key); else rb.delete(key);
          return rb;
        });
        notifyActionError(r);
      }
    });
  }

  const watching = members.filter((m) => watcherIds.has(m.id.toUpperCase()));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {watching.length === 0 && <span style={{ fontSize: 13, color: '#718096' }}>{t('noWatchers')}</span>}
      {watching.map((m) => (
        <span key={m.id} style={{ fontSize: 12, color: '#4a5568' }}>{m.name ?? m.email}</span>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="font-normal" aria-label={t('editWatchers')}>{t('editWatchers')}</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="flex flex-col gap-1">
            {members.length === 0 && <span className="px-2 py-1 text-xs text-muted-foreground">{t('noMembers')}</span>}
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent cursor-pointer">
                <input type="checkbox" checked={watcherIds.has(m.id.toUpperCase())} onChange={() => toggle(m.id)} />
                <span className="text-sm">{m.name ?? m.email}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
