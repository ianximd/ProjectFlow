'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, TrendingDown, Activity, Users, GitCompare,
  AlertTriangle, CheckCircle2, CircleDashed, Loader2,
} from 'lucide-react';

import type {
  BurndownReport,
  VelocityEntry,
  SprintSummaryReport,
  WorkloadEntry,
  CreatedVsResolvedEntry,
} from '@projectflow/types';

import { useStore }                from '@/store/useStore';
import { BurndownChart }           from '@/components/charts/BurndownChart';
import { VelocityChart }           from '@/components/charts/VelocityChart';
import { SprintSummaryWidget }     from '@/components/charts/SprintSummaryWidget';
import { WorkloadChart }           from '@/components/charts/WorkloadChart';
import { CreatedVsResolvedChart }  from '@/components/charts/CreatedVsResolvedChart';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── API helper ──────────────────────────────────────────────────────────────

async function api(path: string, token: string | null) {
  const res = await fetch(`/api/v1${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
    },
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router      = useRouter();
  const accessToken = useStore((s) => s.accessToken);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectId,   setProjectId]   = useState<string | null>(null);
  const [sprintId,    setSprintId]    = useState<string | null>(null);

  // ── Workspace / project / sprint queries ──────────────────────────────────
  const { data: workspaces, isLoading: isLoadingWs } = useQuery<any[]>({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const { ok, status, json } = await api('/workspaces', accessToken);
      if (status === 401) { router.push('/login'); return []; }
      const wss = ok ? (json.data ?? []) : [];
      if (wss.length === 0) router.push('/setup');
      return wss;
    },
  });
  const activeWorkspaceId = workspaceId ?? workspaces?.[0]?.Id ?? null;

  const { data: projects, isLoading: isLoadingProj } = useQuery<any[]>({
    queryKey: ['projects', activeWorkspaceId, accessToken],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const { ok, json } = await api(`/projects?workspaceId=${activeWorkspaceId}`, accessToken);
      return ok ? (json.data ?? []) : [];
    },
  });
  const activeProjectId = projectId ?? projects?.[0]?.Id ?? null;
  const activeProject   = projects?.find((p: any) => p.Id === activeProjectId) ?? projects?.[0];

  const { data: sprints } = useQuery<any[]>({
    queryKey: ['sprints', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/sprints?projectId=${activeProjectId}`, accessToken);
      return ok ? (json.data ?? []) : [];
    },
  });
  // Prefer the ACTIVE sprint if one exists, otherwise the first row.
  const activeSprintId = sprintId
    ?? sprints?.find((s: any) => (s.Status ?? s.status) === 'ACTIVE')?.Id
    ?? sprints?.[0]?.Id
    ?? null;
  const selectedSprint = sprints?.find((s: any) => s.Id === activeSprintId) ?? null;

  // ── Tasks (powers the KPI tiles — single fetch, derive on the client) ─────
  const { data: tasks, isLoading: isLoadingTasks } = useQuery<any[]>({
    queryKey: ['tasks', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/tasks?projectId=${activeProjectId}&pageSize=500`, accessToken);
      return ok ? (json.data ?? []) : [];
    },
  });

  // ── Report queries ─────────────────────────────────────────────────────────
  const { data: burndown, isLoading: loadingBd } = useQuery<BurndownReport | null>({
    queryKey: ['report-burndown', activeSprintId, accessToken],
    enabled:  !!activeSprintId,
    queryFn:  async () => (await api(`/reports/burndown?sprintId=${activeSprintId}`, accessToken)).json.data ?? null,
  });

  const { data: velocity = [], isLoading: loadingVel } = useQuery<VelocityEntry[]>({
    queryKey: ['report-velocity', activeProjectId, accessToken],
    enabled:  !!activeProjectId,
    queryFn:  async () => (await api(`/reports/velocity?projectId=${activeProjectId}&numSprints=6`, accessToken)).json.data ?? [],
  });

  const { data: sprintSummary, isLoading: loadingSs } = useQuery<SprintSummaryReport | null>({
    queryKey: ['report-sprint-summary', activeSprintId, accessToken],
    enabled:  !!activeSprintId,
    queryFn:  async () => (await api(`/reports/sprint-summary?sprintId=${activeSprintId}`, accessToken)).json.data ?? null,
  });

  const { data: workload = [], isLoading: loadingWl } = useQuery<WorkloadEntry[]>({
    queryKey: ['report-workload', activeProjectId, accessToken],
    enabled:  !!activeProjectId,
    queryFn:  async () => (await api(`/reports/workload?projectId=${activeProjectId}`, accessToken)).json.data ?? [],
  });

  const { data: cvr = [], isLoading: loadingCvr } = useQuery<CreatedVsResolvedEntry[]>({
    queryKey: ['report-cvr', activeProjectId, accessToken],
    enabled:  !!activeProjectId,
    queryFn:  async () => (await api(`/reports/created-vs-resolved?projectId=${activeProjectId}&weeks=8`, accessToken)).json.data ?? [],
  });

  // ── KPI derivation ─────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    // Buckets are derived once from the full task list rather than via five
    // separate /tasks?status=... fetches — the list payload is small (≤500
    // rows) and the page already shows the user the whole project.
    const all = tasks ?? [];
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const isDone = (t: any) => {
      const s = t.Status ?? t.status ?? '';
      return s === 'Done' || s === 'DONE' || t.ResolvedAt;
    };

    const open       = all.filter((t) => !isDone(t));
    const inProgress = all.filter((t) => (t.Status ?? t.status) === 'In Progress');
    const doneThisWeek = all.filter((t) => {
      if (!t.ResolvedAt) return false;
      const r = new Date(t.ResolvedAt).getTime();
      return Number.isFinite(r) && r >= weekAgo;
    });
    const overdue = open.filter((t) => {
      const d = t.DueDate ?? t.dueDate;
      if (!d) return false;
      return new Date(d).getTime() < now;
    });

    return {
      open:           open.length,
      inProgress:     inProgress.length,
      doneThisWeek:   doneThisWeek.length,
      overdue:        overdue.length,
      total:          all.length,
    };
  }, [tasks]);

  // ── Derived UI state ───────────────────────────────────────────────────────
  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingTasks && !tasks);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;

  // ── Render ─────────────────────────────────────────────────────────────────
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
              <span>Dashboard</span>
              {activeProject?.Key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeProject.Key}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">
              {activeProject?.Name ?? (isLoadingProj ? 'Loading…' : 'No project')}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspaces && workspaces.length > 1 && (
            <Select
              value={activeWorkspaceId ?? undefined}
              onValueChange={(v) => { setWorkspaceId(v); setProjectId(null); setSprintId(null); }}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws: any) => (
                  <SelectItem key={ws.Id} value={ws.Id}>{ws.Name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {projects && projects.length > 1 && (
            <Select
              value={activeProjectId ?? undefined}
              onValueChange={(v) => { setProjectId(v); setSprintId(null); }}
            >
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p: any) => (
                  <SelectItem key={p.Id} value={p.Id}>
                    <span className="font-mono mr-2 text-muted-foreground">{p.Key}</span>
                    {p.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {sprints && sprints.length > 0 && (
            <Select
              value={activeSprintId ?? undefined}
              onValueChange={(v) => setSprintId(v)}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Sprint" />
              </SelectTrigger>
              <SelectContent>
                {sprints.map((s: any) => (
                  <SelectItem key={s.Id} value={s.Id}>
                    {s.Name} {(s.Status ?? s.status) === 'ACTIVE' && '· Active'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {isInitialLoading ? (
        <DashboardSkeleton />
      ) : noProject ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              icon={CircleDashed}
              label="Open"
              value={kpi.open}
              tone="default"
              hint={`${kpi.total} total in project`}
            />
            <KpiTile
              icon={Loader2}
              label="In progress"
              value={kpi.inProgress}
              tone="info"
            />
            <KpiTile
              icon={CheckCircle2}
              label="Resolved this week"
              value={kpi.doneThisWeek}
              tone="success"
            />
            <KpiTile
              icon={AlertTriangle}
              label="Overdue"
              value={kpi.overdue}
              tone={kpi.overdue > 0 ? 'danger' : 'muted'}
            />
          </div>

          {/* ── Gadget grid ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Gadget
              icon={TrendingDown}
              title="Burndown"
              subtitle={selectedSprint?.Name}
              isEmpty={!activeSprintId}
              isLoading={loadingBd}
              emptyMsg="No sprint selected"
            >
              {burndown ? <BurndownChart data={burndown} /> : <NoData />}
            </Gadget>

            <Gadget
              icon={Activity}
              title="Sprint summary"
              subtitle={selectedSprint?.Name}
              isEmpty={!activeSprintId}
              isLoading={loadingSs}
              emptyMsg="No sprint selected"
            >
              {sprintSummary ? <SprintSummaryWidget data={sprintSummary} /> : <NoData />}
            </Gadget>

            <Gadget
              icon={BarChart3}
              title="Velocity"
              subtitle="Last 6 sprints"
              wide
              isLoading={loadingVel}
              isEmpty={velocity.length === 0}
              emptyMsg="No completed sprints yet"
            >
              <VelocityChart data={velocity} />
            </Gadget>

            <Gadget
              icon={Users}
              title="Team workload"
              isLoading={loadingWl}
              isEmpty={workload.length === 0}
              emptyMsg="No assigned issues"
            >
              <WorkloadChart data={workload} />
            </Gadget>

            <Gadget
              icon={GitCompare}
              title="Created vs resolved"
              subtitle="Last 8 weeks"
              isLoading={loadingCvr}
              isEmpty={cvr.length === 0}
              emptyMsg="No data for this period"
            >
              <CreatedVsResolvedChart data={cvr} />
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
  icon: Icon, title, subtitle, children, wide, isLoading, isEmpty, emptyMsg,
}: {
  icon: typeof BarChart3;
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
  wide?: boolean;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyMsg?: string;
}) {
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
        {isLoading ? (
          <Skeleton className="h-[230px] w-full" />
        ) : isEmpty ? (
          <div className="text-xs text-muted-foreground text-center">{emptyMsg ?? 'No data'}</div>
        ) : (
          <div className="w-full">{children}</div>
        )}
      </div>
    </Card>
  );
}

function NoData() {
  return <div className="text-xs text-muted-foreground text-center">No data</div>;
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className={cn('h-[300px] rounded-xl', i === 2 && 'lg:col-span-2')} />
        ))}
      </div>
    </>
  );
}

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <BarChart3 className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to report on</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace, then come back to see velocity, burndown, and workload insights.
        </div>
      </div>
    </div>
  );
}
