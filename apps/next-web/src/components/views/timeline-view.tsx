'use client';

import { useMemo, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useLiveTasks, buildAccepts } from '@/lib/realtime/useLiveTasks';
import { updateTaskDates } from '@/server/actions/roadmap';
import { notifyActionError } from '@/lib/apiErrorToast';
import { barGeometry } from './gantt-geom';
import { taskFieldValue } from './field-options';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { CustomField, FieldRef, SavedView } from '@projectflow/types';
import type { Task } from '@/server/queries/normalize-task';

const PX_PER_DAY = 24;
const ROW_H = 30;
const DEFAULT_GROUP: FieldRef = { kind: 'builtin', key: 'status' };

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  customFields?: CustomField[];
  live: LiveScopeProp;
}

export function TimelineView({ taskPage, activeView, customFields = [], live }: Props) {
  const t = useTranslations('Timeline');
  const router = useRouter();
  const [pending, start] = useTransition();

  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  const tasks = useLiveTasks(
    baseTasks,
    live.projectId ? { projectId: live.projectId } : { workspaceId: live.workspaceId },
    buildAccepts(live.acceptKind, live.listScopeId),
  );

  const groupField = activeView.config.groupBy ?? DEFAULT_GROUP;

  const origin = useMemo(() => {
    const starts = tasks.map((x) => x.startDate).filter(Boolean) as string[];
    if (!starts.length) return new Date().toISOString().slice(0, 10);
    return starts.reduce((a, b) => (a < b ? a : b)).slice(0, 10);
  }, [tasks]);

  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const tk of tasks) {
      const raw = taskFieldValue(tk, groupField, customFields);
      const key = raw == null || raw === '' ? '∅' : String(raw);
      const arr = m.get(key) ?? [];
      arr.push(tk);
      m.set(key, arr);
    }
    return [...m.entries()];
  }, [tasks, groupField, customFields]);

  const onDrag = (taskId: string, start0: string | null, due0: string | null) => {
    if (!start0 || !due0) return;
    start(async () => {
      const ns = new Date(Date.parse(start0) + 86400000).toISOString().slice(0, 10);
      const nd = new Date(Date.parse(due0) + 86400000).toISOString();
      const r = await updateTaskDates(taskId, { startDate: ns, dueDate: nd });
      if (!r.ok) return notifyActionError(r);
      router.refresh();
    });
  };

  return (
    <div data-testid="view-body-timeline" className="flex h-full flex-col overflow-auto rounded-lg border border-border bg-background">
      {groups.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</div>}
      {groups.map(([label, rows]) => (
        <div key={label} data-testid="timeline-lane" data-group={label} className="border-b border-border/60">
          <div className="bg-muted/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          {rows.map((tk) => {
            const g = barGeometry(origin, tk.startDate, tk.dueDate, PX_PER_DAY);
            return (
              <div key={tk.id} className="relative flex items-center" style={{ height: ROW_H }} data-testid="timeline-row" data-task-id={tk.id}>
                <div className="w-40 shrink-0 truncate px-2 text-xs">{tk.title}</div>
                <div className="relative flex-1">
                  {!g.hidden && (
                    <button type="button" data-testid="timeline-bar"
                      className={cn('absolute rounded bg-primary px-1 text-[10px] text-white')}
                      style={{ left: g.x, width: g.width, height: 16, top: ROW_H / 2 - 8 }}
                      disabled={pending}
                      onDoubleClick={() => onDrag(tk.id, tk.startDate, tk.dueDate)}>
                      {tk.title}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
