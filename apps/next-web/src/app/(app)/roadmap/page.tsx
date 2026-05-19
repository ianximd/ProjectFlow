'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { GitBranch, CalendarRange, AlertCircle } from 'lucide-react';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { GanttChart, type GanttItem } from '@/components/GanttChart';
import { TaskDrawer } from '@/components/TaskDrawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── API helper ───────────────────────────────────────────────────────────────

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return { ok: res.ok, status: res.status, json: {} };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) notifyApiError(json, res.status);
  return { ok: res.ok, status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RoadmapPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const currentWorkspaceId  = useStore((s) => s.currentWorkspaceId);
  const currentProjectId    = useStore((s) => s.currentProjectId);
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject   = useStore((s) => s.setCurrentProject);

  // ── Workspace / project ────────────────────────────────────────────────────
  const { data: workspaces, isLoading: isLoadingWs } = useQuery<any[]>({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const { status, ok, json } = await api('/workspaces', accessToken);
      if (status === 401) { router.push('/login'); return []; }
      const wss = ok ? (json.data ?? []) : [];
      if (wss.length === 0) router.push('/setup');
      return wss;
    },
  });
  const activeWorkspaceId = currentWorkspaceId ?? workspaces?.[0]?.Id ?? null;

  const { data: projects, isLoading: isLoadingProj } = useQuery<any[]>({
    queryKey: ['projects', activeWorkspaceId, accessToken],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const { ok, json } = await api(`/projects?workspaceId=${activeWorkspaceId}`, accessToken);
      return ok ? (json.data ?? []) : [];
    },
  });
  const activeProjectId = currentProjectId ?? projects?.[0]?.Id ?? null;
  const activeProject   = projects?.find((p: any) => p.Id === activeProjectId) ?? projects?.[0];

  // ── Roadmap data ───────────────────────────────────────────────────────────
  const { data, isLoading: isLoadingRoadmap } = useQuery<{
    items: any[]; deps: any[];
  }>({
    queryKey: ['roadmap', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/roadmap?projectId=${activeProjectId}`, accessToken);
      if (!ok) return { items: [], deps: [] };
      return json.data ?? { items: [], deps: [] };
    },
  });

  const updateDates = useMutation({
    mutationFn: ({ taskId, startDate, dueDate }: {
      taskId: string; startDate: string | null; dueDate: string | null;
    }) =>
      api(`/roadmap/tasks/${taskId}/dates`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify({
          startDate, dueDate,
          // The PATCH endpoint distinguishes "field not provided" from
          // "explicitly clear" — pass the clear flags so dragging a bar to
          // remove dates actually nulls the columns instead of being a no-op.
          clearStartDate: startDate === null,
          clearDueDate:   dueDate   === null,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roadmap', activeProjectId] }),
  });

  // Drawer state — clicking a bar opens the issue in the same TaskDrawer
  // used by the board/backlog so the user stays in flow.
  const [selectedTask, setSelectedTask] = useState<GanttItem | null>(null);

  // ── Derived counts for the header pill ─────────────────────────────────────
  const { scheduled, unscheduled } = useMemo(() => {
    const items = data?.items ?? [];
    let s = 0, u = 0;
    for (const it of items) {
      if (it.startDate || it.dueDate) s++; else u++;
    }
    return { scheduled: s, unscheduled: u };
  }, [data?.items]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingRoadmap && !data);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;
  const items     = data?.items ?? [];
  const hasItems  = items.length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header + switchers ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <GitBranch className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Roadmap</span>
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
          {hasItems && (
            <Badge variant="outline" size="sm" appearance="outline" className="gap-1.5">
              <CalendarRange className="size-3" />
              <span>{scheduled} scheduled</span>
              {unscheduled > 0 && (
                <span className="text-muted-foreground">· {unscheduled} without dates</span>
              )}
            </Badge>
          )}

          {workspaces && workspaces.length > 1 && (
            <Select
              value={activeWorkspaceId ?? undefined}
              onValueChange={(v) => setCurrentWorkspace(v)}
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
            <Select value={activeProjectId ?? undefined} onValueChange={(v) => setCurrentProject(v)}>
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
        </div>
      </div>

      {/* ── Helper banner ─────────────────────────────────────────────────── */}
      {hasItems && unscheduled > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>{unscheduled}</strong>{' '}
            {unscheduled === 1 ? 'item has' : 'items have'} no start or due date and won't appear on the timeline.
            Open them from the backlog to set dates.
          </span>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {isInitialLoading ? (
          <RoadmapSkeleton />
        ) : noProject ? (
          <EmptyProjectState />
        ) : !hasItems ? (
          <EmptyRoadmapState />
        ) : (
          <Card className="h-full overflow-hidden p-0">
            <GanttChart
              items={items}
              deps={data?.deps ?? []}
              onUpdateDates={(taskId, startDate, dueDate) =>
                updateDates.mutate({ taskId, startDate, dueDate })
              }
              onOpenTask={(it) => setSelectedTask(it)}
            />
          </Card>
        )}
      </div>

      <TaskDrawer
        task={selectedTask}
        workspaceId={activeWorkspaceId}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty / loading states
// ─────────────────────────────────────────────────────────────────────────────

function RoadmapSkeleton() {
  return (
    <Card className="h-full overflow-hidden p-0">
      <div className="grid grid-cols-[260px_1fr] gap-0">
        <div className="border-r border-border p-4 flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
        <div className="p-4 flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-5 w-[60%]" style={{ marginLeft: `${i * 30}px` }} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <GitBranch className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to show</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace to start mapping out a roadmap.
        </div>
      </div>
    </div>
  );
}

function EmptyRoadmapState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <CalendarRange className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No scheduled work</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Tasks appear on the roadmap once they have a start or due date.
          Open an issue from the backlog and set its dates to see it here.
        </div>
      </div>
    </div>
  );
}
