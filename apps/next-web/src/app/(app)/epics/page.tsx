'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Award, Plus, Search, Filter, X, Calendar, Hourglass, CheckCircle2,
} from 'lucide-react';

import type { EpicSummary } from '@projectflow/types';

import { useStore } from '@/store/useStore';
import { TaskDrawer } from '@/components/TaskDrawer';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Lookup tables ────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;
const PRIORITY_META: Record<string, { dot: string; label: string }> = {
  HIGHEST: { dot: 'bg-red-500',    label: 'Highest' },
  HIGH:    { dot: 'bg-orange-500', label: 'High' },
  MEDIUM:  { dot: 'bg-amber-500',  label: 'Medium' },
  LOW:     { dot: 'bg-sky-500',    label: 'Low' },
  LOWEST:  { dot: 'bg-slate-400',  label: 'Lowest' },
};

const STATUS_META: Record<string, string> = {
  'To Do':       'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'In Progress': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Done':        'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Blocked':     'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

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
  return { ok: res.ok, status: res.status, json };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Days from today to a date (rounded). Negative = past.
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((t - now.getTime()) / 86_400_000);
}

// ─── Progress ring (kept from old page — small SVG, no deps) ────────────────
function ProgressRing({ total, done }: { total: number; done: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const r = 18, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const stroke = pct >= 100 ? 'stroke-emerald-500' : pct > 0 ? 'stroke-primary' : 'stroke-muted';
  return (
    <div className="shrink-0" title={`${done}/${total} done (${pct}%)`} aria-label={`${pct}% complete`}>
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" className="stroke-muted/40" strokeWidth="4" />
        <circle
          cx="22" cy="22" r={r} fill="none"
          className={stroke}
          strokeWidth="4"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 22 22)"
        />
        <text x="22" y="26" textAnchor="middle" fontSize="10" className="fill-foreground font-semibold">
          {pct}%
        </text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function EpicsPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectId,   setProjectId]   = useState<string | null>(null);
  const [search,         setSearch]         = useState('');
  const [statusFilter,   setStatusFilter]   = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [selectedEpicTaskId, setSelectedEpicTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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

  // ── Epics ──────────────────────────────────────────────────────────────────
  const { data: epics, isLoading: isLoadingEpics } = useQuery<EpicSummary[]>({
    queryKey: ['epics', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/epics?projectId=${activeProjectId}`, accessToken);
      return ok ? (json.epics ?? []) : [];
    },
  });

  // ── Filter pipeline (purely client-side) ───────────────────────────────────
  const filteredEpics = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (epics ?? []).filter((e) => {
      if (statusFilter   !== 'ALL' && e.status   !== statusFilter)   return false;
      if (priorityFilter !== 'ALL' && e.priority !== priorityFilter) return false;
      if (q) {
        const hay = `${e.title} ${e.issueKey}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [epics, search, statusFilter, priorityFilter]);

  // ── Status options derived from data so we don't hardcode the project's
  // workflow. Falls back to a known set when the data is empty.
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    (epics ?? []).forEach((e) => set.add(e.status));
    if (set.size === 0) ['To Do', 'In Progress', 'Done'].forEach((s) => set.add(s));
    return [...set];
  }, [epics]);

  // ── KPI derivation ─────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const all = epics ?? [];
    const completed  = all.filter((e) => e.status === 'Done').length;
    const inProgress = all.filter((e) => e.status === 'In Progress').length;
    const now = Date.now();
    const overdue = all.filter((e) =>
      e.status !== 'Done'
      && !!e.dueDate
      && new Date(e.dueDate).getTime() < now,
    ).length;
    return { total: all.length, completed, inProgress, overdue };
  }, [epics]);

  // ── Create-epic mutation (POST /tasks with type=EPIC) ──────────────────────
  const createMutation = useMutation({
    mutationFn: async (input: { title: string; priority: string; dueDate?: string }) => {
      const body: Record<string, unknown> = {
        title:       input.title,
        type:        'EPIC',
        priority:    input.priority,
        projectId:   activeProjectId,
        workspaceId: activeWorkspaceId,
      };
      if (input.dueDate) body.dueDate = new Date(input.dueDate).toISOString();
      const { ok, json } = await api('/tasks', accessToken, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!ok) throw new Error(json?.error?.message ?? 'Create failed');
      return json.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epics', activeProjectId] });
      setCreateOpen(false);
    },
  });

  // ── Derived UI state ───────────────────────────────────────────────────────
  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingEpics && !epics);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;
  const activeFilterCount =
    (statusFilter   !== 'ALL' ? 1 : 0) +
    (priorityFilter !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // The drawer expects a task-shaped object; we have an EpicSummary. Build a
  // minimal task-shape from the selected row so the drawer can fetch the
  // rest (comments, attachments, etc.) by id.
  const selectedTask = useMemo(() => {
    if (!selectedEpicTaskId) return null;
    const e = (epics ?? []).find((x) => x.id === selectedEpicTaskId);
    if (!e) return null;
    return {
      Id: e.id, IssueKey: e.issueKey, Title: e.title,
      Status: e.status, Priority: e.priority, Type: 'EPIC', DueDate: e.dueDate,
    };
  }, [selectedEpicTaskId, epics]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Award className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Epics</span>
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
              onValueChange={(v) => { setWorkspaceId(v); setProjectId(null); }}
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
            <Select value={activeProjectId ?? undefined} onValueChange={(v) => setProjectId(v)}>
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
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} disabled={!activeProjectId}>
            <Plus className="size-4" /> New epic
          </Button>
        </div>
      </div>

      {isInitialLoading ? (
        <EpicsSkeleton />
      ) : noProject ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={Award}          label="Total epics"   value={kpi.total}      tone="default" />
            <KpiTile icon={Hourglass}      label="In progress"   value={kpi.inProgress} tone="info" />
            <KpiTile icon={CheckCircle2}   label="Completed"     value={kpi.completed}  tone="success" />
            <KpiTile icon={Calendar}       label="Overdue"       value={kpi.overdue}    tone={kpi.overdue > 0 ? 'danger' : 'muted'} />
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or key…"
                className="h-8 pl-7 text-xs"
                aria-label="Filter epics"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {statusOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All priorities</SelectItem>
                {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p]?.label ?? p}</SelectItem>)}
              </SelectContent>
            </Select>

            {activeFilterCount > 0 && (
              <>
                <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
                  <Filter className="size-3" />
                  {activeFilterCount}
                </Badge>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => { setSearch(''); setStatusFilter('ALL'); setPriorityFilter('ALL'); }}
                  className="h-8 px-2 text-xs"
                >
                  <X className="size-3.5" /> Clear
                </Button>
              </>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              Showing <strong className="text-foreground">{filteredEpics.length}</strong> of <strong className="text-foreground">{epics?.length ?? 0}</strong>
            </div>
          </div>

          {/* ── Epic grid ─────────────────────────────────────────────────── */}
          {(!epics || epics.length === 0) ? (
            <EmptyEpicsState onCreate={() => setCreateOpen(true)} />
          ) : filteredEpics.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No epics match the current filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredEpics.map((e) => (
                <EpicCard
                  key={e.id}
                  epic={e}
                  onOpen={() => setSelectedEpicTaskId(e.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <CreateEpicDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        isPending={createMutation.isPending}
        error={(createMutation.error as Error | null)?.message ?? null}
      />

      <TaskDrawer task={selectedTask as any} onClose={() => setSelectedEpicTaskId(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function EpicCard({ epic, onOpen }: { epic: EpicSummary; onOpen: () => void }) {
  const pm        = PRIORITY_META[epic.priority] ?? PRIORITY_META.MEDIUM!;
  const statusCls = STATUS_META[epic.status] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  const dLeft     = daysUntil(epic.dueDate);
  const dueBadge  =
    dLeft == null ? null
    : dLeft < 0   ? { cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
                      text: `${Math.abs(dLeft)}d overdue` }
    : dLeft <= 7  ? { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
                      text: dLeft === 0 ? 'Due today' : `Due in ${dLeft}d` }
    :              { cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
                     text: `Due in ${dLeft}d` };

  return (
    <Card
      onClick={onOpen}
      className="p-4 flex gap-3 cursor-pointer hover:border-primary/30 transition-colors"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      aria-label={`Open epic ${epic.issueKey}`}
    >
      <ProgressRing total={epic.totalChildren} done={epic.completedChildren} />
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-muted-foreground/80 truncate">
            {epic.issueKey}
          </span>
          <span
            className={cn('inline-block size-2 rounded-full shrink-0', pm.dot)}
            aria-label={`Priority: ${pm.label}`}
            title={`Priority: ${pm.label}`}
          />
        </div>

        <h3 className="text-sm font-semibold text-foreground line-clamp-2">
          {epic.title}
        </h3>

        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', statusCls)}>
            {epic.status}
          </span>
          {dueBadge && (
            <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold', dueBadge.cls)}>
              <Calendar className="size-3" /> {dueBadge.text}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {epic.completedChildren}/{epic.totalChildren} {epic.totalChildren === 1 ? 'story' : 'stories'}
          </span>
        </div>
      </div>
    </Card>
  );
}

type KpiTone = 'default' | 'info' | 'success' | 'danger' | 'muted';

function KpiTile({
  icon: Icon, label, value, tone = 'default',
}: {
  icon: typeof Award;
  label: string;
  value: number;
  tone?: KpiTone;
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
    </Card>
  );
}

function CreateEpicDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; priority: string; dueDate?: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [title,    setTitle]    = useState('');
  const [priority, setPriority] = useState<string>('MEDIUM');
  const [dueDate,  setDueDate]  = useState('');

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) { onClose(); setTitle(''); setPriority('MEDIUM'); setDueDate(''); } }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New epic</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Date input emits YYYY-MM-DD; pass through and let the API convert
            // to an ISO timestamp. Empty string ⇒ omit entirely.
            onSubmit({
              title: title.trim(),
              priority,
              ...(dueDate ? { dueDate } : {}),
            });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="epic-title" className="text-xs font-medium text-muted-foreground">Title</label>
              <Input
                id="epic-title" required autoFocus value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's the big goal?"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="epic-priority" className="text-xs font-medium text-muted-foreground">Priority</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="epic-priority" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>{PRIORITY_META[p]?.label ?? p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="epic-due" className="text-xs font-medium text-muted-foreground">Due date (optional)</label>
                <Input id="epic-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isPending || !title.trim()}>
              {isPending ? 'Creating…' : 'Create epic'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EpicsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    </>
  );
}

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Award className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to show</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace to start organising work into epics.
        </div>
      </div>
    </div>
  );
}

function EmptyEpicsState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Award className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No epics yet</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Epics group related stories and tasks under a single goal. Create one to start mapping out larger initiatives.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Create your first epic
      </Button>
    </div>
  );
}
