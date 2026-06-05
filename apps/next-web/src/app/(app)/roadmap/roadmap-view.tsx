'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GitBranch, CalendarRange, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { notifyActionError } from '@/lib/apiErrorToast';
import { updateTaskDates } from '@/server/actions/roadmap';
import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';
import { GanttChart } from '@/components/GanttChart';
import type { GanttItem } from '@/components/GanttChart';
import { TaskDrawer } from '@/components/TaskDrawer';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  ctx: WorkspaceProjectContext;
  items: any[];
  deps: any[];
}

export function RoadmapView({ ctx, items, deps }: Props) {
  const t = useTranslations('Roadmap');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Drawer state ─────────────────────────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = useMemo(
    () => (items ?? []).find((it: any) => it.id === selectedTaskId) ?? null,
    [items, selectedTaskId],
  );

  // ── Derived header counts ─────────────────────────────────────────────────────
  const { scheduled, unscheduled } = useMemo(() => {
    let s = 0, u = 0;
    for (const it of items ?? []) {
      if (it.startDate || it.dueDate) s++; else u++;
    }
    return { scheduled: s, unscheduled: u };
  }, [items]);

  // ── Dates mutation via Server Action ─────────────────────────────────────────
  function handleUpdateDates(taskId: string, startDate: string | null, dueDate: string | null) {
    startTransition(async () => {
      const res = await updateTaskDates(taskId, {
        startDate,
        dueDate,
        clearStartDate: startDate === null,
        clearDueDate: dueDate === null,
      });
      if (!res.ok) {
        notifyActionError(res);
        return;
      }
      router.refresh();
    });
  }

  // ── Derived state ─────────────────────────────────────────────────────────────
  const hasItems = (items ?? []).length > 0;
  const noProject = !ctx.activeProjectId;
  const activeProject = ctx.projects.find((p) => p.id === ctx.activeProjectId) ?? ctx.projects[0];

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header + switchers ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <GitBranch className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('breadcrumb')}</span>
              {activeProject?.key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeProject.key}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">
              {activeProject?.name ?? t('noProject')}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasItems && (
            <Badge variant="outline" size="sm" appearance="outline" className="gap-1.5">
              <CalendarRange className="size-3" />
              <span>{t('scheduled', { count: scheduled })}</span>
              {unscheduled > 0 && (
                <span className="text-muted-foreground">· {t('withoutDates', { count: unscheduled })}</span>
              )}
            </Badge>
          )}
          <WorkspaceProjectSwitcher
            workspaces={ctx.workspaces}
            projects={ctx.projects}
            activeWorkspaceId={ctx.activeWorkspaceId}
            activeProjectId={ctx.activeProjectId}
          />
        </div>
      </div>

      {/* ── Unscheduled warning banner ────────────────────────────────────────── */}
      {hasItems && unscheduled > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>{unscheduled}</strong>{' '}
            {unscheduled === 1
              ? 'item has'
              : 'items have'}{' '}
            no start or due date and won&apos;t appear on the timeline.
            Open them from the backlog to set dates.
          </span>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {noProject ? (
          <EmptyProjectState />
        ) : !hasItems ? (
          <EmptyRoadmapState />
        ) : (
          <Card className={isPending ? 'h-full overflow-hidden p-0 opacity-60 pointer-events-none' : 'h-full overflow-hidden p-0'}>
            <GanttChart
              items={items as GanttItem[]}
              deps={deps}
              onUpdateDates={handleUpdateDates}
              onOpenTask={(it) => setSelectedTaskId(it.id)}
            />
          </Card>
        )}
      </div>

      {/* TaskDrawer is unchanged — still fetches its own data client-side */}
      <TaskDrawer
        task={selectedTask}
        workspaceId={ctx.activeWorkspaceId}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty states
// ─────────────────────────────────────────────────────────────────────────────

function EmptyProjectState() {
  const t = useTranslations('Roadmap');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <GitBranch className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyProjectTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyProjectBody')}
        </div>
      </div>
    </div>
  );
}

function EmptyRoadmapState() {
  const t = useTranslations('Roadmap');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <CalendarRange className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyRoadmapTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyRoadmapBody')}
        </div>
      </div>
    </div>
  );
}
