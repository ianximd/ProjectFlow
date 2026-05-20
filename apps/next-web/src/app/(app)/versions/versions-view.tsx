'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Tag, Plus, Search, Filter, X, Calendar, Archive, Rocket, Edit3, Trash2,
  CheckCircle2, CircleDashed, ArchiveX,
} from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import {
  createVersion, updateVersion, releaseVersion, archiveVersion, deleteVersion,
} from '@/server/actions/versions';
import { useSelectionBridge, WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Version } from '@/server/queries/versions';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type VersionStatus = 'UNRELEASED' | 'RELEASED' | 'ARCHIVED';

interface Props {
  ctx: WorkspaceProjectContext;
  versions: Version[];
}

// ── Status meta ───────────────────────────────────────────────────────────────

const STATUS_META: Record<VersionStatus, { label: string; cls: string; barCls: string }> = {
  UNRELEASED: {
    label:  'Unreleased',
    cls:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    barCls: 'bg-indigo-500',
  },
  RELEASED: {
    label:  'Released',
    cls:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    barCls: 'bg-emerald-500',
  },
  ARCHIVED: {
    label:  'Archived',
    cls:    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    barCls: 'bg-slate-500',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((t - now.getTime()) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────────────

export function VersionsView({ ctx, versions }: Props) {
  const [isPending, startTransition] = useTransition();

  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | VersionStatus>('ALL');
  const [createOpen,   setCreateOpen]   = useState(false);
  const [editing,      setEditing]      = useState<Version | null>(null);
  const [actionError,  setActionError]  = useState<string | null>(null);

  // ── Selection bridge ────────────────────────────────────────────────────────
  useSelectionBridge({
    activeWorkspaceId: ctx.activeWorkspaceId,
    activeProjectId:   ctx.activeProjectId,
    cookieWorkspaceId: ctx.cookieWorkspaceId,
    cookieProjectId:   ctx.cookieProjectId,
    workspaceIds:      ctx.workspaces.map((w) => w.id),
    projectIds:        ctx.projects.map((p) => p.id),
  });

  // ── Active project label ────────────────────────────────────────────────────
  const activeProject = ctx.projects.find((p) => p.id === ctx.activeProjectId) ?? ctx.projects[0];

  // ── Filter pipeline ─────────────────────────────────────────────────────────
  const filteredVersions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return versions.filter((v) => {
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
      const aStatus = a.status as VersionStatus;
      const bStatus = b.status as VersionStatus;
      if (aStatus !== bStatus) return rank[aStatus] - rank[bStatus];
      if (aStatus === 'UNRELEASED') {
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      }
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
  }, [filteredVersions]);

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => ({
    total:      versions.length,
    unreleased: versions.filter((v) => v.status === 'UNRELEASED').length,
    released:   versions.filter((v) => v.status === 'RELEASED').length,
    archived:   versions.filter((v) => v.status === 'ARCHIVED').length,
  }), [versions]);

  const activeFilterCount = (statusFilter !== 'ALL' ? 1 : 0) + (search.trim() ? 1 : 0);

  // ── Mutation helpers ────────────────────────────────────────────────────────
  function runAction(fn: () => Promise<{ ok: boolean; error?: string; code?: string; status?: number }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) notifyActionError(res as { error: string; code?: string; status?: number });
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
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
              {(activeProject as any)?.key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{(activeProject as any).key}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">
              {activeProject?.name ?? 'No project'}
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
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCreateOpen(true)}
            disabled={!ctx.activeProjectId}
          >
            <Plus className="size-4" /> New version
          </Button>
        </div>
      </div>

      {!ctx.activeProjectId ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={Tag}          label="Total versions" value={kpi.total}      tone="default" />
            <KpiTile icon={CircleDashed} label="Unreleased"     value={kpi.unreleased} tone="info" />
            <KpiTile icon={CheckCircle2} label="Released"       value={kpi.released}   tone="success" />
            <KpiTile icon={ArchiveX}     label="Archived"       value={kpi.archived}   tone="muted" />
          </div>

          {/* ── Filter bar ─────────────────────────────────────────────────── */}
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
              Showing <strong className="text-foreground">{orderedVersions.length}</strong> of <strong className="text-foreground">{versions.length}</strong>
            </div>
          </div>

          {/* ── Version list ────────────────────────────────────────────────── */}
          {versions.length === 0 ? (
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
                  busy={isPending}
                  onEdit={() => setEditing(v)}
                  onRelease={() => runAction(() => releaseVersion(v.id))}
                  onArchive={() => runAction(() => archiveVersion(v.id))}
                  onDelete={() => {
                    if (window.confirm(
                      `Delete version "${v.name}"?\n\nThis won't remove the issues themselves — they'll just be detached from this version.`,
                    )) {
                      runAction(() => deleteVersion(v.id, ctx.activeProjectId!));
                    }
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Create dialog ───────────────────────────────────────────────────── */}
      <VersionDialog
        mode="create"
        open={createOpen}
        initial={null}
        onClose={() => { setCreateOpen(false); setActionError(null); }}
        onSubmit={(input) => {
          setActionError(null);
          startTransition(async () => {
            const res = await createVersion({
              projectId:   ctx.activeProjectId!,
              name:        input.name,
              description: input.description || undefined,
              startDate:   input.startDate   || undefined,
              releaseDate: input.releaseDate  || undefined,
            });
            if (!res.ok) {
              setActionError(res.error);
            } else {
              setCreateOpen(false);
            }
          });
        }}
        isPending={isPending}
        error={actionError}
      />

      {/* ── Edit dialog ─────────────────────────────────────────────────────── */}
      <VersionDialog
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => { setEditing(null); setActionError(null); }}
        onSubmit={(input) => {
          if (!editing) return;
          setActionError(null);
          // PATCH semantics: send only what actually changed.
          const changed: Partial<{ name: string; description: string; startDate: string; releaseDate: string }> = {};
          if (input.name        !== editing.name)                  changed.name        = input.name;
          if (input.description !== (editing.description ?? ''))   changed.description = input.description;
          if (input.startDate   !== (editing.startDate   ?? ''))   changed.startDate   = input.startDate;
          if (input.releaseDate !== (editing.releaseDate ?? ''))   changed.releaseDate = input.releaseDate;
          startTransition(async () => {
            const res = await updateVersion(editing.id, changed);
            if (!res.ok) {
              setActionError(res.error);
            } else {
              setEditing(null);
            }
          });
        }}
        isPending={isPending}
        error={actionError}
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
  const sm      = STATUS_META[version.status as VersionStatus] ?? STATUS_META.UNRELEASED;
  const dLeft   = daysUntil(version.releaseDate);
  const showDue = version.status === 'UNRELEASED' && dLeft != null;
  const dueBadge = !showDue
    ? null
    : dLeft! < 0
      ? { cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',     text: `${Math.abs(dLeft!)}d overdue` }
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

// ── KPI tile ──────────────────────────────────────────────────────────────────

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

// ── Version dialog ────────────────────────────────────────────────────────────

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
            onSubmit({ name: name.trim(), description: description.trim(), startDate, releaseDate });
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

// ── Empty states ──────────────────────────────────────────────────────────────

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
