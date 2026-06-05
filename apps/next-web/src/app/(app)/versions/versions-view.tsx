'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Tag, Plus, Search, Filter, X, Calendar, Archive, Rocket, Edit3, Trash2,
  CheckCircle2, CircleDashed, ArchiveX,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { notifyActionError } from '@/lib/apiErrorToast';
import {
  createVersion, updateVersion, releaseVersion, archiveVersion, deleteVersion,
} from '@/server/actions/versions';
import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
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
// Labels are now translated at render time via t(); these cls/barCls remain.
const STATUS_CLS: Record<VersionStatus, { cls: string; barCls: string }> = {
  UNRELEASED: {
    cls:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    barCls: 'bg-indigo-500',
  },
  RELEASED: {
    cls:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    barCls: 'bg-emerald-500',
  },
  ARCHIVED: {
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
  const t = useTranslations('Versions');
  const [isPending, startTransition] = useTransition();

  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | VersionStatus>('ALL');
  const [createOpen,   setCreateOpen]   = useState(false);
  const [editing,      setEditing]      = useState<Version | null>(null);
  const [actionError,  setActionError]  = useState<string | null>(null);

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
  // ARCHIVED (newest first).
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
          <WorkspaceProjectSwitcher
            workspaces={ctx.workspaces}
            projects={ctx.projects}
            activeWorkspaceId={ctx.activeWorkspaceId}
            activeProjectId={ctx.activeProjectId}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => { setCreateOpen(true); setActionError(null); }}
            disabled={!ctx.activeProjectId}
          >
            <Plus className="size-4" /> {t('newVersion')}
          </Button>
        </div>
      </div>

      {!ctx.activeProjectId ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={Tag}          label={t('kpiTotal')}      value={kpi.total}      tone="default" />
            <KpiTile icon={CircleDashed} label={t('kpiUnreleased')} value={kpi.unreleased} tone="info" />
            <KpiTile icon={CheckCircle2} label={t('kpiReleased')}   value={kpi.released}   tone="success" />
            <KpiTile icon={ArchiveX}     label={t('kpiArchived')}   value={kpi.archived}   tone="muted" />
          </div>

          {/* ── Filter bar ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('filterSearchPlaceholder')}
                className="h-8 pl-7 text-xs"
                aria-label={t('filterSearchAriaLabel')}
              />
            </div>

            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'ALL' | VersionStatus)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t('filterStatusPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('filterAllStatuses')}</SelectItem>
                <SelectItem value="UNRELEASED">{t('filterUnreleased')}</SelectItem>
                <SelectItem value="RELEASED">{t('filterReleased')}</SelectItem>
                <SelectItem value="ARCHIVED">{t('filterArchived')}</SelectItem>
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
                  <X className="size-3.5" /> {t('filterClear')}
                </Button>
              </>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              {t('showingOf', { shown: orderedVersions.length, total: versions.length })}
            </div>
          </div>

          {/* ── Version list ────────────────────────────────────────────────── */}
          {versions.length === 0 ? (
            <EmptyVersionsState onCreate={() => setCreateOpen(true)} />
          ) : orderedVersions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              {t('noMatchFilters')}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {orderedVersions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  busy={isPending}
                  onEdit={() => { setEditing(v); setActionError(null); }}
                  onRelease={() => runAction(() => releaseVersion(v.id))}
                  onArchive={() => runAction(() => archiveVersion(v.id))}
                  onDelete={() => {
                    if (window.confirm(
                      t('deleteConfirm', { name: v.name }),
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
        key="create"
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
        key={editing?.id ?? 'edit'}
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => { setEditing(null); setActionError(null); }}
        onSubmit={(input) => {
          if (!editing) return;
          setActionError(null);
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
  const t = useTranslations('Versions');
  const sm      = STATUS_CLS[version.status as VersionStatus] ?? STATUS_CLS.UNRELEASED;
  const statusLabel =
    version.status === 'RELEASED' ? t('statusReleased')
    : version.status === 'ARCHIVED' ? t('statusArchived')
    : t('statusUnreleased');
  const dLeft   = daysUntil(version.releaseDate);
  const showDue = version.status === 'UNRELEASED' && dLeft != null;
  const dueBadge = !showDue
    ? null
    : dLeft! < 0
      ? { cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
          text: t('overdueByDays', { count: Math.abs(dLeft!) }) }
      : dLeft! <= 7
        ? { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
            text: dLeft === 0 ? t('releasesToday') : t('daysToRelease', { count: dLeft }) }
        : { cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
            text: t('daysToRelease', { count: dLeft }) };

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
              {statusLabel}
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
                {version.status === 'RELEASED' ? t('releasedLabel') : t('plannedLabel')} {version.releaseDate.slice(0, 10)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {version.status === 'UNRELEASED' && (
              <Button size="sm" variant="primary" onClick={onRelease} disabled={busy}>
                <Rocket className="size-3.5" /> {t('actionRelease')}
              </Button>
            )}
            {version.status !== 'ARCHIVED' && (
              <Button size="sm" variant="ghost" onClick={onArchive} disabled={busy} aria-label={t('actionArchiveAriaLabel')}>
                <Archive className="size-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label={t('actionEditAriaLabel')}>
              <Edit3 className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive" aria-label={t('actionDeleteAriaLabel')} disabled={busy}>
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
              {t('progressIssues', { completed: version.completedIssues, total: version.totalIssues })}
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
  const t = useTranslations('Versions');
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('dialogCreateTitle') : t('dialogEditTitle', { name: initial?.name ?? '' })}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name: name.trim(), description: description.trim(), startDate, releaseDate });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="v-name" className="text-xs font-medium text-muted-foreground">
                {t('dialogNameLabel')}
              </label>
              <Input
                id="v-name" required autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('dialogNamePlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="v-desc" className="text-xs font-medium text-muted-foreground">
                {t('dialogDescLabel')}
              </label>
              <textarea
                id="v-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder={t('dialogDescPlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="v-start" className="text-xs font-medium text-muted-foreground">
                  {t('dialogStartDateLabel')}
                </label>
                <Input id="v-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="v-release" className="text-xs font-medium text-muted-foreground">
                  {t('dialogReleaseDateLabel')}
                </label>
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
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              {t('dialogCancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={isPending || !name.trim()}>
              {isPending
                ? (mode === 'create' ? t('dialogCreating') : t('dialogSaving'))
                : (mode === 'create' ? t('dialogCreate')   : t('dialogSave'))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function EmptyProjectState() {
  const t = useTranslations('Versions');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Tag className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyProjectTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyProjectBody')}
        </div>
      </div>
    </div>
  );
}

function EmptyVersionsState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('Versions');
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Tag className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyVersionsTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyVersionsBody')}
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> {t('createFirstVersion')}
      </Button>
    </div>
  );
}
