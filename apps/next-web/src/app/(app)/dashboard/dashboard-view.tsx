'use client';

import { useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3, TrendingDown, Activity, Users, GitCompare,
  AlertTriangle, CheckCircle2, CircleDashed, Loader2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { BurndownChart }           from '@/components/charts/BurndownChart';
import { VelocityChart }           from '@/components/charts/VelocityChart';
import { SprintSummaryWidget }     from '@/components/charts/SprintSummaryWidget';
import { WorkloadChart }           from '@/components/charts/WorkloadChart';
import { CreatedVsResolvedChart }  from '@/components/charts/CreatedVsResolvedChart';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card }     from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge }    from '@/components/ui/badge';
import { cn }       from '@/lib/utils';

import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext }                  from '@/server/context';
import type { Sprint }                                   from '@/server/queries/sprints';
import type { Task }                                     from '@/server/queries/tasks';

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  ctx:               WorkspaceProjectContext;
  sprints:           Sprint[];
  activeSprintId:    string | null;
  tasks:             Task[];
  burndown:          any | null;
  velocity:          any[];
  sprintSummary:     any | null;
  workload:          any[];
  createdVsResolved: any[];
}

export function DashboardView({
  ctx, sprints, activeSprintId, tasks,
  burndown, velocity, sprintSummary, workload, createdVsResolved,
}: Props) {
  const t = useTranslations('Dashboard');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── KPI derivation ───────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const all: Task[] = Array.isArray(tasks) ? tasks : [];
    const now     = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const isDone = (tk: Task) => {
      const s = tk.status ?? '';
      return s === 'Done' || s === 'DONE' || !!tk.resolvedAt;
    };

    const open       = all.filter((tk) => !isDone(tk));
    const inProgress = all.filter((tk) => tk.status === 'In Progress');
    const doneThisWeek = all.filter((tk) => {
      if (!tk.resolvedAt) return false;
      const ts = new Date(tk.resolvedAt).getTime();
      return Number.isFinite(ts) && ts >= weekAgo;
    });
    const overdue = open.filter((tk) => {
      const d = tk.dueDate;
      if (!d) return false;
      return new Date(d).getTime() < now;
    });

    return {
      open:         open.length,
      inProgress:   inProgress.length,
      doneThisWeek: doneThisWeek.length,
      overdue:      overdue.length,
      total:        all.length,
    };
  }, [tasks]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const noProject     = !ctx.activeProjectId;
  const activeProject = ctx.projects.find((p) => p.id === ctx.activeProjectId) ?? ctx.projects[0];
  const selectedSprint = sprints.find((s) => s.id === activeSprintId) ?? null;

  // ── Sprint dropdown handler — navigate to ?sprint= so the server re-fetches ─
  function handleSprintChange(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('sprint', id);
    startTransition(() => { router.push(url.pathname + url.search); });
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header + switchers ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <BarChart3 className="size-5" />
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
              {activeProject?.name ?? t('noProjectFallback')}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceProjectSwitcher
            workspaces={ctx.workspaces}
            projects={ctx.projects}
            activeWorkspaceId={ctx.activeWorkspaceId}
            activeProjectId={ctx.activeProjectId}
          />
          {sprints.length > 0 && (
            <Select
              value={activeSprintId ?? undefined}
              onValueChange={handleSprintChange}
              disabled={isPending}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder={t('sprintPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {sprints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{(s.status ?? '').toUpperCase() === 'ACTIVE' ? t('sprintActiveSuffix') : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {noProject ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              icon={CircleDashed}
              label={t('kpiOpen')}
              value={kpi.open}
              tone="default"
              hint={t('kpiTotalHint', { total: kpi.total })}
            />
            <KpiTile
              icon={Loader2}
              label={t('kpiInProgress')}
              value={kpi.inProgress}
              tone="info"
            />
            <KpiTile
              icon={CheckCircle2}
              label={t('kpiResolvedThisWeek')}
              value={kpi.doneThisWeek}
              tone="success"
            />
            <KpiTile
              icon={AlertTriangle}
              label={t('kpiOverdue')}
              value={kpi.overdue}
              tone={kpi.overdue > 0 ? 'danger' : 'muted'}
            />
          </div>

          {/* ── Gadget grid ──────────────────────────────────────────────────── */}
          <div className={cn('grid grid-cols-1 lg:grid-cols-2 gap-3', isPending && 'opacity-60 transition-opacity')}>
            <Gadget
              icon={TrendingDown}
              title={t('gadgetBurndown')}
              subtitle={selectedSprint?.name}
              isEmpty={!activeSprintId}
              emptyMsg={t('emptyNoSprint')}
            >
              {burndown ? <BurndownChart data={burndown} /> : <NoData />}
            </Gadget>

            <Gadget
              icon={Activity}
              title={t('gadgetSprintSummary')}
              subtitle={selectedSprint?.name}
              isEmpty={!activeSprintId}
              emptyMsg={t('emptyNoSprint')}
            >
              {sprintSummary ? <SprintSummaryWidget data={sprintSummary} /> : <NoData />}
            </Gadget>

            <Gadget
              icon={BarChart3}
              title={t('gadgetVelocity')}
              subtitle={t('gadgetVelocitySubtitle')}
              wide
              isEmpty={velocity.length === 0}
              emptyMsg={t('emptyNoCompletedSprints')}
            >
              <VelocityChart data={velocity} />
            </Gadget>

            <Gadget
              icon={Users}
              title={t('gadgetWorkload')}
              isEmpty={workload.length === 0}
              emptyMsg={t('emptyNoAssignedIssues')}
            >
              <WorkloadChart data={workload} />
            </Gadget>

            <Gadget
              icon={GitCompare}
              title={t('gadgetCreatedVsResolved')}
              subtitle={t('gadgetCreatedVsResolvedSubtitle')}
              isEmpty={createdVsResolved.length === 0}
              emptyMsg={t('emptyNoPeriodData')}
            >
              <CreatedVsResolvedChart data={createdVsResolved} />
            </Gadget>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

type KpiTone = 'default' | 'info' | 'success' | 'danger' | 'muted';

function KpiTile({
  icon: Icon, label, value, tone = 'default', hint,
}: {
  icon: typeof CircleDashed;
  label: string;
  value: number;
  tone?: KpiTone;
  hint?: string;
}) {
  const toneCls: Record<KpiTone, string> = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    info:    'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    danger:  'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    muted:   'bg-muted text-muted-foreground',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn('inline-flex size-9 items-center justify-center rounded-md', toneCls[tone])}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground truncate">{label}</div>
          <div className="text-xl font-semibold text-foreground tabular-nums">{value.toLocaleString()}</div>
        </div>
      </div>
      {hint && (
        <div className="mt-2 text-xs text-muted-foreground truncate">{hint}</div>
      )}
    </Card>
  );
}

function Gadget({
  icon: Icon, title, subtitle, children, wide, isEmpty, emptyMsg,
}: {
  icon: typeof BarChart3;
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
  wide?: boolean;
  isEmpty?: boolean;
  emptyMsg?: string;
}) {
  const t = useTranslations('Dashboard');
  return (
    <Card className={cn('p-0 overflow-hidden flex flex-col', wide && 'lg:col-span-2')}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <Badge variant="outline" size="xs" appearance="outline" className="font-normal">
            {subtitle}
          </Badge>
        )}
      </div>
      <div className="p-4 flex-1 min-h-[260px] flex items-center justify-center">
        {isEmpty ? (
          <div className="text-xs text-muted-foreground text-center">{emptyMsg ?? t('noData')}</div>
        ) : (
          <div className="w-full">{children}</div>
        )}
      </div>
    </Card>
  );
}

function NoData() {
  const t = useTranslations('Dashboard');
  return <div className="text-xs text-muted-foreground text-center">{t('noData')}</div>;
}

function EmptyProjectState() {
  const t = useTranslations('Dashboard');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <BarChart3 className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyProjectTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyProjectBody')}
        </div>
      </div>
    </div>
  );
}
