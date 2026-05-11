'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag, Plus, Search, Filter, X, Calendar, Archive, Rocket, Edit3, Trash2,
  CheckCircle2, CircleDashed, ArchiveX,
} from 'lucide-react';

import type { Version, VersionStatus } from '@projectflow/types';

import { useStore } from '@/store/useStore';
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

// ── Status meta ──────────────────────────────────────────────────────────────

const STATUS_META: Record<VersionStatus, { label: string; cls: string; barCls: string }> = {
  UNRELEASED: {
    label:  'Unreleased',
    cls:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    barCls: 'bg-indigo-500',
  },
  RELEASED:   {
    label:  'Released',
    cls:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    barCls: 'bg-emerald-500',
  },
  ARCHIVED:   {
    label:  'Archived',
    cls:    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    barCls: 'bg-slate-500',
  },
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
    credentials: 'include',
  });
  if (res.status === 204) return { ok: res.ok, status: res.status, json: {} };
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((t - now.getTime()) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function VersionsPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectId,   setProjectId]   = useState<string | null>(null);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | VersionStatus>('ALL');

  const [createOpen,    setCreateOpen]   = useState(false);
  const [editing,       setEditing]      = useState<Version | null>(null);

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

  // ── Versions ───────────────────────────────────────────────────────────────
  const { data: versions, isLoading: isLoadingVersions } = useQuery<Version[]>({
    queryKey: ['versions', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/versions?projectId=${activeProjectId}`, accessToken);
      return ok ? (json.versions ?? []) : [];
    },
  });

  const invalidateVersions = () =>
    qc.invalidateQueries({ queryKey: ['versions', activeProjectId] });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (input: {
      name: string; description?: string; startDate?: string; releaseDate?: string;
    }) => {
      const body: Record<string, unknown> = { projectId: activeProjectId, name: input.name };
      if (input.description) body.description = input.description;
      if (input.startDate)   body.startDate   = input.startDate;
      if (input.releaseDate) body.releaseDate = input.releaseDate;
      const { ok, json } = await api('/versions', accessToken, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!ok) throw new Error(json?.error ?? 'Create failed');
      return json.version;
    },
    onSuccess: () => { invalidateVersions(); setCreateOpen(false); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { ok, json } = await api(`/versions/${id}`, accessToken, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      if (!ok) throw new Error(json?.error ?? 'Update failed');
      return json.version;
    },
    onSuccess: () => { invalidateVersions(); setEditing(null); },
  });

  const statusActionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'release' | 'archive' }) => {
      const { ok, json } = await api(`/versions/${id}/${action}`, accessToken, { method: 'POST' });
      if (!ok) throw new Error(json?.error ?? `${action} failed`);
      return json.version;
    },
    onSuccess: invalidateVersions,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { ok } = await api(`/versions/${id}?projectId=${activeProjectId}`, accessToken, {
        method: 'DELETE',
      });
      if (!ok) throw new Error('Delete failed');
    },
    onSuccess: invalidateVersions,
  });

  // ── Filter pipeline ────────────────────────────────────────────────────────
  const filteredVersions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (versions ?? []).filter((v) => {
      if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
      if (q && !v.name.toLowerCase().includes(q)
           && !(v.description ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [versions, search, statusFilter]);

  // Order: UNRELEASED (soonest release first) → RELEASED (newest first) →
  // ARCHIVED (newest first). Helps the manager focus on what's coming up.
  const orderedVersions = useMemo(() => {
    const arr = [...filteredVersions];
    const rank: Record<VersionStatus, number> = { UNRELEASED: 0, RELEASED: 1, ARCHIVED: 2 };
    return arr.sort((a, b) => {
      if (a.status !== b.status) return rank[a.status] - rank[b.status];
      if (a.status === 'UNRELEASED') {
        // Soonest release first; missing dates go last.
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      }
      // For released/archived, most recently created first.
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [filteredVersions]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const all = versions ?? [];
    return {
      total:      all.length,
      unreleased: all.filter((v) => v.status === 'UNRELEASED').length,
      released:   all.filter((v) => v.status === 'RELEASED').length,
      archived:   all.filter((v) => v.status === 'ARCHIVED').length,
    };
  }, [versions]);

  // ── Derived UI state ───────────────────────────────────────────────────────
  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingVersions && !versions);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;
  const activeFilterCount =
    (statusFilter !== 'ALL' ? 1 : 0) + (search.trim() ? 1 : 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Tag className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Versions</span>
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
            <Plus className="size-4" /> New version
          </Button>
        </div>
      </div>

      {isInitialLoading ? (
        <VersionsSkeleton />
      ) : noProject ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={Tag}            label="Total versions" value={kpi.total}      tone="default" />
            <KpiTile icon={CircleDashed}   label="Unreleased"     value={kpi.unreleased} tone="info" />
            <KpiTile icon={CheckCircle2}   label="Released"       value={kpi.released}   tone="success" />
            <KpiTile icon={ArchiveX}       label="Archived"       value={kpi.archived}   tone="muted" />
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or description…"
                className="h-8 pl-7 text-xs"
                aria-label="Filter versions"
              />
            </div>

            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'ALL' | VersionStatus)}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="UNRELEASED">Unreleased</SelectItem>
                <SelectItem value="RELEASED">Released</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
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
                  onClick={() => { setSearch(''); setStatusFilter('ALL'); }}
                  className="h-8 px-2 text-xs"
                >
                  <X className="size-3.5" /> Clear
                </Button>
              </>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              Showing <strong className="text-foreground">{orderedVersions.length}</strong> of <strong className="text-foreground">{versions?.length ?? 0}</strong>
            </div>
          </div>

          {/* ── Version list ──────────────────────────────────────────────── */}
          {!versions || versions.length === 0 ? (
            <EmptyVersionsState onCreate={() => setCreateOpen(true)} />
          ) : orderedVersions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No versions match the current filters.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {orderedVersions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  onEdit={() => setEditing(v)}
                  onRelease={() => statusActionMutation.mutate({ id: v.id, action: 'release' })}
                  onArchive={() => statusActionMutation.mutate({ id: v.id, action: 'archive' })}
                  onDelete={() => {
                    if (window.confirm(`Delete version "${v.name}"?\n\nThis won't remove the issues themselves — they'll just be detached from this version.`)) {
                      deleteMutation.mutate(v.id);
                    }
                  }}
                  busy={statusActionMutation.isPending || deleteMutation.isPending}
                />
              ))}
            </div>
          )}
        </>
      )}

      <VersionDialog
        mode="create"
        open={createOpen}
        initial={null}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        isPending={createMutation.isPending}
        error={(createMutation.error as Error | null)?.message ?? null}
      />

      <VersionDialog
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={(input) => {
          if (!editing) return;
          updateMutation.mutate({
            id:    editing.id,
            // PATCH semantics: send only what actually changed.
            patch: {
              ...(input.name        !== editing.name        ? { name:        input.name }        : {}),
              ...(input.description !== (editing.description ?? '') ? { description: input.description } : {}),
              ...(input.startDate   !== (editing.startDate   ?? '') ? { startDate:   input.startDate   } : {}),
              ...(input.releaseDate !== (editing.releaseDate ?? '') ? { releaseDate: input.releaseDate } : {}),
            },
          });
        }}
        isPending={updateMutation.isPending}
        error={(updateMutation.error as Error | null)?.message ?? null}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function VersionRow({
  version, onEdit, onRelease, onArchive, onDelete, busy,
}: {
  version: Version;
  onEdit:    () => void;
  onRelease: () => void;
  onArchive: () => void;
  onDelete:  () => void;
  busy: boolean;
}) {
  const sm  = STATUS_META[version.status];
  const dLeft = daysUntil(version.releaseDate);
  const showDueBadge = version.status === 'UNRELEASED' && dLeft != null;
  const dueBadge = !showDueBadge
    ? null
    : dLeft! < 0
      ? { cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300', text: `${Math.abs(dLeft!)}d overdue` }
      : dLeft! <= 7
        ? { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', text: dLeft === 0 ? 'Releases today' : `${dLeft}d to release` }
        : { cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', text: `${dLeft}d to release` };

  const pct = version.totalIssues > 0
    ? Math.round((version.completedIssues / version.totalIssues) * 100)
    : 0;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        {/* Top row: badge + name + actions */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', sm.cls)}>
              {sm.label}
            </span>
            <h3 className="text-sm font-semibold text-foreground truncate">{version.name}</h3>
            {dueBadge && (
              <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold', dueBadge.cls)}>
                <Calendar className="size-3" /> {dueBadge.text}
              </span>
            )}
            {version.releaseDate && version.status !== 'UNRELEASED' && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="size-3" />
                {version.status === 'RELEASED' ? 'Released' : 'Planned'} {version.releaseDate.slice(0, 10)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {version.status === 'UNRELEASED' && (
              <Button size="sm" variant="primary" onClick={onRelease} disabled={busy}>
                <Rocket className="size-3.5" /> Release
              </Button>
            )}
            {version.status !== 'ARCHIVED' && (
              <Button size="sm" variant="ghost" onClick={onArchive} disabled={busy} aria-label="Archive">
                <Archive className="size-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit">
              <Edit3 className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive" aria-label="Delete" disabled={busy}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Description */}
        {version.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">
            {version.description}
          </p>
        )}

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              <span className="font-medium text-foreground tabular-nums">{version.completedIssues}</span>
              {' / '}
              <span className="tabular-nums">{version.totalIssues}</span>
              {' '}{version.totalIssues === 1 ? 'issue' : 'issues'} done
            </span>
            <span className="tabular-nums font-medium text-foreground">{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full transition-all', sm.barCls)}
              style={{ width: `${pct}%` }}
              aria-label={`${pct}% complete`}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

type KpiTone = 'default' | 'info' | 'success' | 'danger' | 'muted';

function KpiTile({
  icon: Icon, label, value, tone = 'default',
}: {
  icon: typeof Tag;
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

function VersionDialog({
  mode, open, initial, onClose, onSubmit, isPending, error,
}: {
  mode: 'create' | 'edit';
  open: boolean;
  initial: Version | null;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string; startDate: string; releaseDate: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  // Each open of this dialog mounts a fresh instance via the `key` on
  // <DialogContent>, so these initialisers run anew per open and we don't
  // need a separate effect to re-seed when switching between rows.
  const [name,        setName]        = useState(initial?.name        ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startDate,   setStartDate]   = useState(initial?.startDate   ?? '');
  const [releaseDate, setReleaseDate] = useState(initial?.releaseDate ?? '');

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setName(''); setDescription(''); setStartDate(''); setReleaseDate('');
        }
      }}
    >
      <DialogContent key={initial?.id ?? mode}>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New version' : `Edit ${initial?.name ?? 'version'}`}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              name:        name.trim(),
              description: description.trim(),
              startDate,
              releaseDate,
            });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="v-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="v-name" required autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. v1.0.0"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="v-desc" className="text-xs font-medium text-muted-foreground">Description</label>
              <textarea
                id="v-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Release notes, scope, or goals…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="v-start" className="text-xs font-medium text-muted-foreground">Start date</label>
                <Input id="v-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="v-release" className="text-xs font-medium text-muted-foreground">Release date</label>
                <Input id="v-release" type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
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
            <Button type="submit" variant="primary" disabled={isPending || !name.trim()}>
              {isPending
                ? (mode === 'create' ? 'Creating…' : 'Saving…')
                : (mode === 'create' ? 'Create version' : 'Save changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VersionsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="flex flex-col gap-3 mt-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
    </>
  );
}

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Tag className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to show</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace to start tracking releases as versions.
        </div>
      </div>
    </div>
  );
}

function EmptyVersionsState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Tag className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No versions yet</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Versions group issues into a release. Create one to start tracking what's shipping when.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Create your first version
      </Button>
    </div>
  );
}
