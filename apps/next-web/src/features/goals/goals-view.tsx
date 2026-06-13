'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Target, Trophy, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { notifyActionError } from '@/lib/apiErrorToast';
import {
  createGoalFolder,
  deleteGoalFolder,
  createGoal,
  updateGoal,
  deleteGoal,
  deleteTarget,
} from '@/server/actions/goals';
import { TargetEditor } from './target-editor';
import { goalProgress, targetRatio } from './goal-progress';
import { Button } from '@/components/ui/button';
import type { Goal, GoalFolder, GoalWithProgress, GoalStatus, TargetWithRatio } from '@projectflow/types';

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ ratio, label }: { ratio: number; label?: string }) {
  const pct = Math.round(ratio * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="w-10 text-right text-xs font-medium tabular-nums text-muted-foreground"
        data-testid="progress-pct"
      >
        {pct}%
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CLASS: Record<GoalStatus, string> = {
  active:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  achieved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  archived: 'bg-muted text-muted-foreground',
};

function StatusBadge({ status, t }: { status: GoalStatus; t: ReturnType<typeof useTranslations> }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

// ── Target value display ──────────────────────────────────────────────────────

function TargetValueDisplay({ tgt }: { tgt: TargetWithRatio }) {
  if (tgt.kind === 'boolean') {
    return <span className="text-xs text-muted-foreground">{tgt.currentValue && tgt.currentValue >= 1 ? '✓' : '○'}</span>;
  }
  if (tgt.kind === 'task') {
    return (
      <span className="text-xs text-muted-foreground">
        {tgt.currentValue ?? 0} / {tgt.targetValue ?? 0}
      </span>
    );
  }
  const prefix = tgt.kind === 'currency' && tgt.currencyCode ? `${tgt.currencyCode} ` : '';
  const suffix = tgt.kind === 'number' && tgt.unit ? ` ${tgt.unit}` : '';
  return (
    <span className="text-xs text-muted-foreground">
      {prefix}{tgt.currentValue ?? 0}{suffix} / {prefix}{tgt.targetValue ?? 0}{suffix}
    </span>
  );
}

// ── Target row ────────────────────────────────────────────────────────────────

function TargetRow({
  tgt,
  goalId,
  onMutated,
}: {
  tgt: TargetWithRatio;
  goalId: string;
  onMutated: () => void;
}) {
  const t = useTranslations('Goals');
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ratio = tgt.ratio ?? targetRatio(tgt);

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteTarget(goalId, tgt.id);
      if (!res.ok) notifyActionError(res);
      else onMutated();
    });
  }

  if (editing) {
    return (
      <TargetEditor
        goalId={goalId}
        existing={tgt}
        onDone={() => { setEditing(false); onMutated(); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="group flex flex-col gap-1 rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          className="flex-1 text-left text-sm font-medium hover:underline"
          onClick={() => setEditing(true)}
        >
          {tgt.name}
        </button>
        <TargetValueDisplay tgt={tgt} />
        <button
          aria-label={t('delete')}
          onClick={handleDelete}
          disabled={isPending}
          className="ml-1 hidden text-muted-foreground hover:text-destructive group-hover:block"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <ProgressBar ratio={ratio} />
    </div>
  );
}

// ── Goal card ─────────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  onMutated,
}: {
  goal: GoalWithProgress;
  onMutated: () => void;
}) {
  const t = useTranslations('Goals');
  const [expanded, setExpanded] = useState(false);
  const [addingTarget, setAddingTarget] = useState(false);
  const [isPending, startTransition] = useTransition();

  const progress = goal.progress ?? goalProgress(goal.targets ?? []);

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteGoal(goal.id);
      if (!res.ok) notifyActionError(res);
      else onMutated();
    });
  }

  function cycleStatus() {
    const next: Record<GoalStatus, GoalStatus> = {
      active: 'achieved',
      achieved: 'archived',
      archived: 'active',
    };
    startTransition(async () => {
      const res = await updateGoal(goal.id, { status: next[goal.status] });
      if (!res.ok) notifyActionError(res);
      else onMutated();
    });
  }

  return (
    <div className="group flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm" data-testid="goal-card">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-muted-foreground"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground" data-testid="goal-name">
              {goal.name}
            </span>
            <button onClick={cycleStatus} disabled={isPending}>
              <StatusBadge status={goal.status} t={t} />
            </button>
            {goal.dueDate && (
              <span className="text-xs text-muted-foreground">{goal.dueDate}</span>
            )}
          </div>
          {/* Progress bar — always visible; 100% triggers e2e assertion */}
          <div className="mt-2">
            <ProgressBar ratio={progress} label={t('progress')} />
          </div>
        </div>
        <button
          aria-label={t('delete')}
          onClick={handleDelete}
          disabled={isPending}
          className="hidden text-muted-foreground hover:text-destructive group-hover:block"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* Targets list (expandable) */}
      {expanded && (
        <div className="ml-6 flex flex-col gap-2">
          {(goal.targets ?? []).map((tgt) => (
            <TargetRow key={tgt.id} tgt={tgt} goalId={goal.id} onMutated={onMutated} />
          ))}
          {addingTarget ? (
            <TargetEditor
              goalId={goal.id}
              onDone={() => { setAddingTarget(false); onMutated(); }}
              onCancel={() => setAddingTarget(false)}
            />
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="w-fit"
              onClick={() => setAddingTarget(true)}
            >
              <Plus className="mr-1 size-3.5" />
              {t('newTarget')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create-goal inline form ───────────────────────────────────────────────────

function CreateGoalForm({
  workspaceId,
  folderId,
  onDone,
  onCancel,
}: {
  workspaceId: string;
  folderId?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('Goals');
  const [name, setName] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const res = await createGoal({ workspaceId, name, folderId: folderId ?? null });
      if (!res.ok) notifyActionError(res);
      else onDone();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
      <input
        autoFocus
        className="flex-1 rounded border bg-background px-2 py-1 text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('field.name')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) handleCreate();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <Button size="sm" onClick={handleCreate} disabled={isPending || !name.trim()}>
        {t('save')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
        {t('cancel')}
      </Button>
    </div>
  );
}

// ── Folder section ────────────────────────────────────────────────────────────

function FolderSection({
  folder,
  goals,
  workspaceId,
  onMutated,
}: {
  folder: GoalFolder | null; // null = "No folder" bucket
  goals: GoalWithProgress[];
  workspaceId: string;
  onMutated: () => void;
}) {
  const t = useTranslations('Goals');
  const [addingGoal, setAddingGoal] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDeleteFolder() {
    if (!folder) return;
    startTransition(async () => {
      const res = await deleteGoalFolder(folder.id);
      if (!res.ok) notifyActionError(res);
      else onMutated();
    });
  }

  return (
    <section className="flex flex-col gap-2">
      {/* Folder header */}
      <div className="group flex items-center gap-2">
        <Target className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">
          {folder ? folder.name : t('noFolder')}
        </span>
        {folder && (
          <button
            aria-label={t('delete')}
            onClick={handleDeleteFolder}
            disabled={isPending}
            className="hidden text-muted-foreground hover:text-destructive group-hover:block"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setAddingGoal(true)}
        >
          <Plus className="mr-1 size-3.5" />
          {t('newGoal')}
        </Button>
      </div>

      {/* Goals */}
      <div className="flex flex-col gap-2 pl-2">
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} onMutated={onMutated} />
        ))}
        {goals.length === 0 && !addingGoal && (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )}
        {addingGoal && (
          <CreateGoalForm
            workspaceId={workspaceId}
            folderId={folder?.id ?? null}
            onDone={() => { setAddingGoal(false); onMutated(); }}
            onCancel={() => setAddingGoal(false)}
          />
        )}
      </div>
    </section>
  );
}

// ── Root view ─────────────────────────────────────────────────────────────────

export interface GoalsViewProps {
  workspaceId: string;
  folders: GoalFolder[];
  /** All goals loaded at SSR time, converted to GoalWithProgress (targets may be empty). */
  goals: GoalWithProgress[];
}

export function GoalsView({ workspaceId, folders, goals }: GoalsViewProps) {
  const t = useTranslations('Goals');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');

  function refresh() {
    router.refresh();
  }

  function handleCreateFolder() {
    if (!folderName.trim()) return;
    startTransition(async () => {
      const res = await createGoalFolder(workspaceId, folderName.trim());
      if (!res.ok) notifyActionError(res);
      else { setFolderName(''); setCreatingFolder(false); router.refresh(); }
    });
  }

  // Group goals by folderId
  const byFolder = new Map<string | null, GoalWithProgress[]>();
  for (const g of goals) {
    const key = g.folderId ?? null;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key)!.push(g);
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="goals-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Trophy className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{t('title')}</div>
          <h2 className="truncate text-base font-semibold text-foreground">{t('heading')}</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreatingFolder((v) => !v)}
          disabled={isPending}
        >
          <Plus className="mr-1 size-3.5" />
          {t('newFolder')}
        </Button>
      </div>

      {/* New folder form */}
      {creatingFolder && (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
          <input
            autoFocus
            className="flex-1 rounded border bg-background px-2 py-1 text-sm"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder={t('field.name')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && folderName.trim()) handleCreateFolder();
              if (e.key === 'Escape') { setCreatingFolder(false); setFolderName(''); }
            }}
          />
          <Button size="sm" onClick={handleCreateFolder} disabled={isPending || !folderName.trim()}>
            {t('save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setCreatingFolder(false); setFolderName(''); }}>
            {t('cancel')}
          </Button>
        </div>
      )}

      {/* Folders → goals */}
      <div className="flex flex-col gap-6">
        {folders.map((folder) => (
          <FolderSection
            key={folder.id}
            folder={folder}
            goals={byFolder.get(folder.id) ?? []}
            workspaceId={workspaceId}
            onMutated={refresh}
          />
        ))}
        {/* Goals not in any folder */}
        {(byFolder.get(null)?.length ?? 0) > 0 || folders.length === 0 ? (
          <FolderSection
            folder={null}
            goals={byFolder.get(null) ?? []}
            workspaceId={workspaceId}
            onMutated={refresh}
          />
        ) : null}
      </div>
    </div>
  );
}
