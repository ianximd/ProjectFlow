// apps/next-web/src/app/(app)/projects/projects-view.tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Folder, Plus, Search, Filter, X, LayoutGrid, Settings, Archive,
  Trash2, Briefcase, ArchiveX, Workflow, Kanban,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { notifyApiError } from '@/lib/apiErrorToast';
import { formatShortDateYear } from '@/lib/date';
import { createProject, archiveProject, deleteProject } from '@/server/actions/projects';
import { useSelectionSwitch } from '@/app/(app)/_components/selection-bridge';
import type { Project, ProjectType, ProjectStatus, Workspace } from '@/server/queries/normalize';
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

// ── Lookup tables (moved verbatim from the old page.tsx) ──────────────────────
const TYPE_META: Record<ProjectType, { icon: typeof Kanban; cls: string }> = {
  KANBAN:   { icon: Kanban,   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  SCRUM:    { icon: Workflow, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  BUSINESS: { icon: Briefcase,cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

const STATUS_META: Record<ProjectStatus, { cls: string }> = {
  ACTIVE:   { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  ARCHIVED: { cls: 'bg-slate-100 text-slate-600  dark:bg-slate-800  dark:text-slate-400' },
  DELETED:  { cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

// Suggest a project key from a name: take initials, uppercase, max 4 chars.
function suggestKey(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 4).toUpperCase();
  return parts.map((p) => p[0]).join('').slice(0, 4).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────

export function ProjectsView({
  workspaces, projects, activeWorkspaceId, cookieWorkspaceId,
}: {
  workspaces: Workspace[];
  projects: Project[];
  activeWorkspaceId: string;
  cookieWorkspaceId: string | null;
}) {
  const t = useTranslations('Projects');
  const [isPending, startTransition] = useTransition();

  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState<'ALL' | ProjectType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectStatus>('ALL');
  const [createOpen,   setCreateOpen]   = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);

  const { switchWorkspace } = useSelectionSwitch();

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  // ── Mutations via Server Actions ─────────────────────────────────────────────
  function handleCreate(input: { name: string; key: string; type: ProjectType; description: string }) {
    setCreateError(null);
    startTransition(async () => {
      const res = await createProject({ workspaceId: activeWorkspaceId, ...input });
      if (res.ok) setCreateOpen(false);
      else setCreateError(res.error);
    });
  }

  function handleArchive(p: Project) {
    if (p.status === 'ARCHIVED') return;
    if (!window.confirm(t('archiveConfirm', { name: p.name }))) return;
    startTransition(async () => {
      const res = await archiveProject(p.id);
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }

  function handleDelete(p: Project) {
    if (!window.confirm(t('deleteConfirm', { name: p.name }))) return;
    startTransition(async () => {
      const res = await deleteProject(p.id);
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }

  // ── Filter pipeline (normalized fields) ──────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (typeFilter   !== 'ALL' && p.type   !== typeFilter)   return false;
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.key} ${p.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, search, typeFilter, statusFilter]);

  const kpi = useMemo(() => ({
    total:    projects.length,
    active:   projects.filter((p) => p.status === 'ACTIVE').length,
    archived: projects.filter((p) => p.status === 'ARCHIVED').length,
    kanban:   projects.filter((p) => p.type === 'KANBAN').length,
  }), [projects]);

  const activeFilterCount =
    (typeFilter   !== 'ALL' ? 1 : 0) +
    (statusFilter !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Folder className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('breadcrumb')}</span>
              {activeWorkspace?.name && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{activeWorkspace.name}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">{t('heading')}</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <Select value={activeWorkspaceId} onValueChange={switchWorkspace}>
              <SelectTrigger className="h-8 w-[200px] text-xs" disabled={isPending}>
                <SelectValue placeholder={t('workspacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} disabled={!activeWorkspaceId}>
            <Plus className="size-4" /> {t('newProject')}
          </Button>
        </div>
      </div>

      {/* ── KPI tiles ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile icon={Folder}   label={t('kpiTotal')}    value={kpi.total}    tone="default" />
        <KpiTile icon={Workflow} label={t('kpiActive')}   value={kpi.active}   tone="success" />
        <KpiTile icon={ArchiveX} label={t('kpiArchived')} value={kpi.archived} tone="muted" />
        <KpiTile icon={Kanban}   label={t('kpiKanban')}   value={kpi.kanban}   tone="info" />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
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

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'ALL' | ProjectType)}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder={t('filterTypePlaceholder')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('filterAllTypes')}</SelectItem>
            <SelectItem value="KANBAN">{t('typeKanban')}</SelectItem>
            <SelectItem value="SCRUM">{t('typeScrum')}</SelectItem>
            <SelectItem value="BUSINESS">{t('typeBusiness')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'ALL' | ProjectStatus)}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder={t('filterStatusPlaceholder')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('filterAllStatuses')}</SelectItem>
            <SelectItem value="ACTIVE">{t('filterStatusActive')}</SelectItem>
            <SelectItem value="ARCHIVED">{t('filterStatusArchived')}</SelectItem>
          </SelectContent>
        </Select>

        {activeFilterCount > 0 && (
          <>
            <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
              <Filter className="size-3" /> {activeFilterCount}
            </Badge>
            <Button
              size="sm" variant="ghost"
              onClick={() => { setSearch(''); setTypeFilter('ALL'); setStatusFilter('ALL'); }}
              className="h-8 px-2 text-xs"
            >
              <X className="size-3.5" /> {t('filterClear')}
            </Button>
          </>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          Showing <strong className="text-foreground">{filtered.length}</strong> of <strong className="text-foreground">{projects.length}</strong>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {projects.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {t('noMatchFilters')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              busy={isPending}
              onArchive={() => handleArchive(p)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateError(null); }}
        onSubmit={handleCreate}
        isPending={isPending}
        error={createError}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Project card
// ─────────────────────────────────────────────────────────────────────────────

function ProjectCard({
  project, onArchive, onDelete, busy,
}: {
  project: Project;
  onArchive: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const t = useTranslations('Projects');
  const { id, name, key, description: desc, type, status, createdAt } = project;
  const tm = TYPE_META[type] ?? TYPE_META.KANBAN;
  const sm = STATUS_META[status] ?? STATUS_META.ACTIVE;
  const TypeIcon = tm.icon;

  const typeLabel = type === 'KANBAN' ? t('typeKanban') : type === 'SCRUM' ? t('typeScrum') : t('typeBusiness');
  const statusLabel = status === 'ACTIVE' ? t('statusActive') : status === 'ARCHIVED' ? t('statusArchived') : t('statusDeleted');

  return (
    <Card className={cn('p-4 flex flex-col gap-3', status !== 'ACTIVE' && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <span className={cn('inline-flex size-9 items-center justify-center rounded-md shrink-0', tm.cls)}>
          <TypeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{name}</h3>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{key}</span>
            <span aria-hidden="true">·</span>
            <Badge size="xs" variant="outline" appearance="outline" className="font-normal">{typeLabel}</Badge>
            <Badge size="xs" variant="outline" appearance="outline" className={cn('font-normal', sm.cls)}>{statusLabel}</Badge>
          </div>
        </div>
      </div>

      {desc && (
        <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{desc}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
        <Link href="/board" className="contents">
          <Button size="sm" variant="outline"><LayoutGrid className="size-3.5" /> {t('openBoard')}</Button>
        </Link>
        <Link href={`/projects/${id}/settings`} className="contents">
          <Button size="sm" variant="ghost"><Settings className="size-3.5" /> {t('settings')}</Button>
        </Link>
        {status === 'ACTIVE' && (
          <Button size="sm" variant="ghost" onClick={onArchive} disabled={busy} aria-label={`${t('statusArchived')} ${name}`}>
            <Archive className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm" variant="ghost"
          className="text-destructive hover:text-destructive ml-auto"
          onClick={onDelete} disabled={busy} aria-label={`${t('statusDeleted')} ${name}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {createdAt && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-mono">
          {t('created', { date: formatShortDateYear(createdAt) })}
        </span>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create dialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateProjectDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; key: string; type: ProjectType; description: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const t = useTranslations('Projects');
  const [name,        setName]        = useState('');
  const [key,         setKey]         = useState('');
  const [type,        setType]        = useState<ProjectType>('KANBAN');
  const [description, setDescription] = useState('');
  const [keyTouched,  setKeyTouched]  = useState(false);

  const typeLabels: Record<ProjectType, string> = {
    KANBAN:   t('typeKanban'),
    SCRUM:    t('typeScrum'),
    BUSINESS: t('typeBusiness'),
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setName(''); setKey(''); setType('KANBAN'); setDescription(''); setKeyTouched(false);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              name:        name.trim(),
              key:         key.trim().toUpperCase(),
              type,
              description: description.trim(),
            });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-name" className="text-xs font-medium text-muted-foreground">{t('dialogNameLabel')}</label>
              <Input
                id="proj-name" required autoFocus value={name}
                onChange={(e) => {
                  const v = e.target.value;
                  setName(v);
                  // Auto-derive the key while the user hasn't manually touched it.
                  if (!keyTouched) setKey(suggestKey(v));
                }}
                placeholder={t('dialogNamePlaceholder')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-key" className="text-xs font-medium text-muted-foreground">{t('dialogKeyLabel')}</label>
              <Input
                id="proj-key" required value={key}
                onChange={(e) => { setKey(e.target.value.toUpperCase()); setKeyTouched(true); }}
                maxLength={10}
                pattern="[A-Z][A-Z0-9]*"
                title={t('dialogKeyTitle')}
                placeholder={t('dialogKeyPlaceholder')}
                className="font-mono text-sm uppercase"
              />
              <span className="text-xs text-muted-foreground">
                {t('dialogKeyHintPrefix')}<code className="font-mono">{key || 'WEB'}-123</code>{t('dialogKeyHintSuffix')}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('dialogTypeLabel')}</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(TYPE_META) as ProjectType[]).map((tp) => {
                  const meta = TYPE_META[tp];
                  const Icon = meta.icon;
                  const active = type === tp;
                  return (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => setType(tp)}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-md border px-2 py-3 transition-colors text-xs font-medium',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-foreground hover:bg-muted/40',
                      )}
                      aria-pressed={active}
                    >
                      <Icon className="size-4" />
                      {typeLabels[tp]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-desc" className="text-xs font-medium text-muted-foreground">{t('dialogDescLabel')}</label>
              <textarea
                id="proj-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder={t('dialogDescPlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
              />
            </div>

            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>{t('dialogCancel')}</Button>
            <Button type="submit" variant="primary" disabled={isPending || !name.trim() || !key.trim()}>
              {isPending ? t('dialogCreating') : t('dialogCreate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI / empty
// ─────────────────────────────────────────────────────────────────────────────

type KpiTone = 'default' | 'info' | 'success' | 'danger' | 'muted';

function KpiTile({
  icon: Icon, label, value, tone = 'default',
}: {
  icon: typeof Folder;
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('Projects');
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Folder className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-md">
          {t('emptyBody')}
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> {t('emptyCreate')}
      </Button>
    </div>
  );
}
