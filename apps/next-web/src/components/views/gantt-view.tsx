'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLiveTasks, buildAccepts } from '@/lib/realtime/useLiveTasks';
import { updateTaskDates } from '@/server/actions/roadmap';
import { captureBaseline } from '@/server/actions/gantt';
import { notifyActionError } from '@/lib/apiErrorToast';
import { barGeometry, lanePath } from './gantt-geom';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { SavedView, ViewGanttData } from '@projectflow/types';

const PX_PER_DAY = 28;
const ROW_H = 32;

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  /** SSR-loaded Gantt payload (edges + critical path + baselines). */
  gantt: ViewGanttData | null;
  live: LiveScopeProp;
}

export function GanttView({ taskPage, activeView, gantt, live }: Props) {
  const t = useTranslations('Gantt');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showBaseline, setShowBaseline] = useState(true);

  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  const tasks = useLiveTasks(
    baseTasks,
    live.projectId ? { projectId: live.projectId } : { workspaceId: live.workspaceId },
    buildAccepts(live.acceptKind, live.listScopeId),
  );

  const critical = useMemo(() => new Set(gantt?.criticalPathIds ?? []), [gantt]);
  const edges = gantt?.edges ?? [];
  const latestBaseline = gantt?.baselines?.[0] ?? null;
  const baselineByTask = useMemo(() => {
    const m = new Map<string, { startDate: string | null; dueDate: string | null }>();
    for (const b of latestBaseline?.tasks ?? []) m.set(b.taskId, { startDate: b.startDate, dueDate: b.dueDate });
    return m;
  }, [latestBaseline]);

  // Chart origin = earliest start among scheduled tasks (fallback: today).
  const origin = useMemo(() => {
    const starts = tasks.map((x) => x.startDate).filter(Boolean) as string[];
    if (!starts.length) return new Date().toISOString().slice(0, 10);
    return starts.reduce((a, b) => (a < b ? a : b)).slice(0, 10);
  }, [tasks]);

  const rowIndex = useMemo(() => new Map(tasks.map((x, i) => [x.id, i])), [tasks]);

  const onDragEnd = (taskId: string, newStart: string, newDue: string) =>
    start(async () => {
      const r = await updateTaskDates(taskId, { startDate: newStart, dueDate: newDue });
      if (!r.ok) return notifyActionError(r);
      router.refresh(); // re-seed SSR; live event also patches concurrent viewers
    });

  const onCaptureBaseline = () =>
    start(async () => {
      const r = await captureBaseline(activeView.id, t('baselineName', { date: new Date().toLocaleDateString() }));
      if (!r.ok) return notifyActionError(r);
      router.refresh();
    });

  // Bar anchor points for dependency lines (right edge of predecessor → left edge of successor).
  const anchor = (id: string, side: 'left' | 'right') => {
    const tk = tasks.find((x) => x.id === id);
    const ri = rowIndex.get(id) ?? 0;
    if (!tk?.startDate || !tk?.dueDate) return null;
    const g = barGeometry(origin, tk.startDate, tk.dueDate, PX_PER_DAY);
    return { x: side === 'right' ? g.x + g.width : g.x, y: ri * ROW_H + ROW_H / 2 };
  };

  return (
    <div data-testid="view-body-gantt" className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">{t('title')}</div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant={showBaseline ? 'primary' : 'outline'} onClick={() => setShowBaseline((s) => !s)} className="h-8 text-xs">
            {t('baseline')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCaptureBaseline} disabled={pending} data-testid="gantt-capture-baseline" className="h-8 text-xs">
            {t('captureBaseline')}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto" data-testid="gantt-canvas">
        {/* Dependency lines (SVG overlay) */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" data-testid="gantt-deps">
          {edges.map((e, i) => {
            const from = anchor(e.dependsOn, 'right');
            const to = anchor(e.taskId, 'left');
            if (!from || !to) return null;
            const onCp = critical.has(e.dependsOn) && critical.has(e.taskId);
            return <path key={i} d={lanePath(from, to)} data-testid="gantt-dep-line" fill="none" stroke={onCp ? '#ef4444' : '#94a3b8'} strokeWidth={onCp ? 2 : 1} />;
          })}
        </svg>

        {tasks.map((tk, ri) => {
          const g = barGeometry(origin, tk.startDate, tk.dueDate, PX_PER_DAY);
          const onCp = critical.has(tk.id);
          const base = baselineByTask.get(tk.id);
          const baseG = showBaseline && base ? barGeometry(origin, base.startDate, base.dueDate, PX_PER_DAY) : null;
          return (
            <div key={tk.id} className="relative flex items-center" style={{ height: ROW_H }} data-testid="gantt-row" data-task-id={tk.id}>
              <div className="w-40 shrink-0 truncate px-2 text-xs">{tk.title}</div>
              <div className="relative flex-1">
                {baseG && !baseG.hidden && (
                  <div className="absolute rounded bg-muted-foreground/20" data-testid="gantt-baseline-bar"
                       style={{ left: baseG.x, width: baseG.width, height: 6, top: ROW_H / 2 + 6 }} />
                )}
                {!g.hidden && (
                  <button
                    type="button"
                    data-testid="gantt-bar"
                    data-critical={onCp ? 'true' : undefined}
                    className={cn('absolute rounded px-1 text-[10px] text-white', onCp ? 'bg-red-500' : 'bg-primary')}
                    style={{ left: g.x, width: g.width, height: 18, top: ROW_H / 2 - 9 }}
                    onDoubleClick={() => {
                      // Minimal move affordance for v1: shift +1 day (a pointer-drag
                      // handler can refine the UX without changing the data contract).
                      if (!tk.startDate || !tk.dueDate) return;
                      const ns = new Date(Date.parse(tk.startDate) + 86400000).toISOString().slice(0, 10);
                      const nd = new Date(Date.parse(tk.dueDate) + 86400000).toISOString();
                      onDragEnd(tk.id, ns, nd);
                    }}
                  >
                    {tk.title}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
