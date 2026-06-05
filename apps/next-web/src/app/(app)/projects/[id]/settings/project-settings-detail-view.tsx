'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Save, Archive, ArchiveRestore, Trash2, AlertTriangle,
  Settings as SettingsIcon, Briefcase, Workflow, Kanban,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { notifyActionError } from '@/lib/apiErrorToast';
import {
  updateProject, archiveProject, restoreProject, deleteProject,
} from '@/server/actions/projects';
import type { ProjectDetail, ProjectType, ProjectStatus } from '@/server/queries/project';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ── Types & meta ─────────────────────────────────────────────────────────────

const TYPE_META: Record<ProjectType, { label: string; icon: typeof Kanban; cls: string }> = {
  KANBAN:   { label: 'Kanban',   icon: Kanban,    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  SCRUM:    { label: 'Scrum',    icon: Workflow,  cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  BUSINESS: { label: 'Business', icon: Briefcase, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  ACTIVE:   { label: 'Active',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-100 text-slate-600  dark:bg-slate-800  dark:text-slate-400' },
  DELETED:  { label: 'Deleted',  cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

// Date inputs use YYYY-MM-DD; the API returns ISO timestamps. Convert.
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────

export function ProjectSettingsDetailView({ project }: { project: ProjectDetail }) {
  const t = useTranslations('ProjectSettings');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [name,        setName]        = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [avatarUrl,   setAvatarUrl]   = useState(project.avatarUrl ?? '');
  const [type,        setType]        = useState<ProjectType>(project.type);
  const [startDate,   setStartDate]   = useState(isoToDateInput(project.startDate));
  const [endDate,     setEndDate]     = useState(isoToDateInput(project.endDate));
  const [saveError,   setSaveError]   = useState<string | null>(null);

  // Re-seed form when the project prop changes (e.g. after a revalidation),
  // but only when no unsaved edits are in progress so we don't stomp them.
  const dirty =
    name        !== project.name ||
    description !== (project.description ?? '') ||
    avatarUrl   !== (project.avatarUrl   ?? '') ||
    type        !== project.type ||
    startDate   !== isoToDateInput(project.startDate) ||
    endDate     !== isoToDateInput(project.endDate);

  useEffect(() => {
    if (dirty) return; // eslint-disable-line react-hooks/exhaustive-deps
    setName(project.name);
    setDescription(project.description ?? '');
    setAvatarUrl(project.avatarUrl ?? '');
    setType(project.type);
    setStartDate(isoToDateInput(project.startDate));
    setEndDate(isoToDateInput(project.endDate));
  }, [project.name, project.description, project.avatarUrl, project.type, project.startDate, project.endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save handler ───────────────────────────────────────────────────────────
  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const changed: Parameters<typeof updateProject>[1] = {};
    if (name        !== project.name)             changed.name        = name;
    if (description !== (project.description ?? '')) changed.description = description || null;
    if (avatarUrl   !== (project.avatarUrl   ?? '')) changed.avatarUrl   = avatarUrl   || null;
    if (type        !== project.type)             changed.type        = type;
    if (startDate   !== isoToDateInput(project.startDate)) {
      changed.startDate = startDate ? new Date(startDate).toISOString() : null;
    }
    if (endDate     !== isoToDateInput(project.endDate)) {
      changed.endDate   = endDate   ? new Date(endDate).toISOString()   : null;
    }
    if (Object.keys(changed).length === 0) return;
    startTransition(async () => {
      const res = await updateProject(project.id, changed);
      if (!res.ok) {
        setSaveError(res.error);
        notifyActionError(res);
      } else {
        setSaveError(null);
      }
    });
  }

  function handleDiscard() {
    setName(project.name);
    setDescription(project.description ?? '');
    setAvatarUrl(project.avatarUrl ?? '');
    setType(project.type);
    setStartDate(isoToDateInput(project.startDate));
    setEndDate(isoToDateInput(project.endDate));
    setSaveError(null);
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const status = project.status;
  const sm     = STATUS_META[status];
  const tm     = TYPE_META[type];

  return (
    <div className="flex h-full flex-col gap-4 max-w-3xl">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('backToProjects')}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <SettingsIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t('projectSettingsBreadcrumb')}</span>
            {project.key && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{project.key}</span>
              </>
            )}
          </div>
          <h2 className="text-base font-semibold text-foreground truncate inline-flex items-center gap-2">
            {project.name || 'Project'}
            <Badge size="xs" variant="outline" appearance="outline" className={cn('font-normal', sm.cls)}>
              {sm.label}
            </Badge>
          </h2>
        </div>
      </div>

      {/* ── General ──────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('general')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('generalDesc')}
            </p>
          </div>
          <Link
            href="/project-settings"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {t('configureLink')}
          </Link>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-name" className="text-xs font-medium text-muted-foreground">{t('nameLabel')}</label>
              <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 min-w-[120px]">
              <label className="text-xs font-medium text-muted-foreground">{t('keyLabel')}</label>
              <div className="h-9 flex items-center rounded-md border border-input bg-muted/40 px-3 font-mono text-sm">
                {project.key}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            {t('keyFixedHint', { example: `${project.key}-42` })}
          </p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="p-desc" className="text-xs font-medium text-muted-foreground">{t('descriptionLabel')}</label>
            <textarea
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('descPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('typeLabel')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_META) as ProjectType[]).map((typeKey) => {
                const meta = TYPE_META[typeKey];
                const Icon = meta.icon;
                const active = type === typeKey;
                return (
                  <button
                    key={typeKey}
                    type="button"
                    onClick={() => setType(typeKey)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-foreground hover:bg-muted/40',
                    )}
                    aria-pressed={active}
                  >
                    <Icon className="size-4" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('typeHint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-start" className="text-xs font-medium text-muted-foreground">{t('startDate')}</label>
              <Input id="p-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-end" className="text-xs font-medium text-muted-foreground">{t('endDate')}</label>
              <Input id="p-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="p-avatar" className="text-xs font-medium text-muted-foreground">{t('avatarUrlLabel')}</label>
            <Input
              id="p-avatar" type="url" value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder={t('avatarUrlPlaceholder')}
            />
          </div>

          {saveError && (
            <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {saveError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={!dirty || isPending}>
              <Save className="size-4" />
              {isPending ? t('savingLabel') : t('saveChangesBtn')}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" onClick={handleDiscard} disabled={isPending}>
                {t('discard')}
              </Button>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              <Badge size="xs" variant="outline" appearance="outline" className={cn('font-normal mr-1', tm.cls)}>
                {tm.label}
              </Badge>
              {t('selected')}
            </div>
          </div>
        </form>
      </Card>

      {/* ── Lifecycle ─────────────────────────────────────────────────────── */}
      <LifecycleCard
        projectId={project.id}
        projectName={project.name}
        status={status}
      />

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <Card className="p-5 border-destructive/40">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="size-4 text-destructive" />
          <h3 className="text-sm font-semibold text-destructive">{t('dangerZone')}</h3>
        </div>
        <DeleteProjectPanel
          projectId={project.id}
          expectedKey={project.key}
          onDeleted={() => router.push('/projects')}
        />
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle card
// ─────────────────────────────────────────────────────────────────────────────

function LifecycleCard({
  projectId, projectName, status,
}: {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
}) {
  const t = useTranslations('ProjectSettings');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleArchive() {
    if (!window.confirm(t('archiveConfirm', { name: projectName }))) return;
    setError(null);
    startTransition(async () => {
      const res = await archiveProject(projectId);
      if (!res.ok) {
        setError(res.error);
        notifyActionError(res);
      }
    });
  }

  function handleRestore() {
    setError(null);
    startTransition(async () => {
      const res = await restoreProject(projectId);
      if (!res.ok) {
        setError(res.error);
        notifyActionError(res);
      }
    });
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-foreground mb-1">{t('lifecycle')}</h3>
      <p className="text-xs text-muted-foreground mb-4">
        {t('lifecycleDesc')}
      </p>

      {status === 'ACTIVE' ? (
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleArchive} disabled={isPending}>
            <Archive className="size-4" />
            {isPending ? t('archiving') : t('archiveProject')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('archiveHint')}</span>
        </div>
      ) : status === 'ARCHIVED' ? (
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleRestore} disabled={isPending}>
            <ArchiveRestore className="size-4" />
            {isPending ? t('restoring') : t('restoreProject')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('restoreHint')}</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('projectDeleted')}</p>
      )}

      {error && (
        <div className="mt-3 rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete panel
// ─────────────────────────────────────────────────────────────────────────────

function DeleteProjectPanel({
  projectId, expectedKey, onDeleted,
}: {
  projectId: string;
  expectedKey: string;
  onDeleted: () => void;
}) {
  const t = useTranslations('ProjectSettings');
  const [isPending, startTransition] = useTransition();
  const [confirmInput, setConfirmInput] = useState('');
  const [deleteError,  setDeleteError]  = useState<string | null>(null);

  const matches = confirmInput.trim().toUpperCase() === expectedKey;

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const res = await deleteProject(projectId);
      if (!res.ok) {
        setDeleteError(res.error);
        notifyActionError(res);
      } else {
        onDeleted();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t('deleteProjectDesc')} <strong>{t('deleteProjectDescStrong')}</strong>
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="p-confirm" className="text-xs font-medium text-muted-foreground">
          {t('deleteConfirmLabel')} <code className="font-mono text-foreground">{expectedKey}</code>
        </label>
        <Input
          id="p-confirm"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          className="font-mono text-sm uppercase max-w-sm"
          autoComplete="off"
        />
      </div>
      {deleteError && (
        <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {deleteError}
        </div>
      )}
      <div>
        <Button variant="destructive" onClick={handleDelete} disabled={!matches || isPending}>
          <Trash2 className="size-4" />
          {isPending ? t('deleting') : t('deleteProject')}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton (exported for loading.tsx)
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectSettingsLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>

      {/* General card */}
      <Skeleton className="h-72 rounded-xl" />

      {/* Lifecycle card */}
      <Skeleton className="h-24 rounded-xl" />

      {/* Danger zone card */}
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
