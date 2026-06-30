'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, CalendarClock, Pause, Pencil, Play, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { ScheduleReportDialog } from '@/components/ScheduleReportDialog';
import { ScheduledRunHistory } from '@/components/ScheduledRunHistory';
import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
import { listSchedules, updateSchedule, removeSchedule } from '@/server/actions/scheduled-reports';
import {
  createDashboard, updateDashboard, deleteDashboard, setDefaultDashboard,
} from '@/server/actions/dashboards';
import { loadWorkspaceMembers } from '@/server/actions/members';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Dashboard, ScheduledReport } from '@projectflow/types';

interface Props {
  ctx: WorkspaceProjectContext;
  dashboards: Dashboard[];
  active: Dashboard;
}

export function DashboardView({ ctx, dashboards, active }: Props) {
  const t = useTranslations('Dashboard');
  const t2 = useTranslations('ScheduledReport');
  const router = useRouter();

  const [dashBusy, startDash] = useTransition();

  // Navigate to another dashboard via the ?id= param so the server re-fetches it.
  function goToDashboard(id: string) {
    router.push(`/dashboard?id=${encodeURIComponent(id)}`);
  }

  function handleNewDashboard() {
    const name = window.prompt(t('newDashboardPrompt'))?.trim();
    if (!name) return;
    startDash(async () => {
      // New dashboards share the current dashboard's scope (a workspace sibling).
      const r = await createDashboard({
        scopeType: active.scopeType,
        scopeId: active.scopeId,
        name,
        workspaceId: active.workspaceId,
      });
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      goToDashboard(r.data.id);
    });
  }

  function handleRenameDashboard() {
    const name = window.prompt(t('renamePrompt'), active.name)?.trim();
    if (!name || name === active.name) return;
    startDash(async () => {
      const r = await updateDashboard(active.id, { name });
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      router.refresh();
    });
  }

  function handleDeleteDashboard() {
    if (!window.confirm(t('deleteDashboardConfirm'))) return;
    startDash(async () => {
      const r = await deleteDashboard(active.id);
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      const next = dashboards.find((d) => d.id !== active.id);
      if (next) goToDashboard(next.id);
      else router.push('/dashboard');
    });
  }

  function handleMakeDefault() {
    startDash(async () => {
      const r = await setDefaultDashboard(active.id);
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      router.refresh();
    });
  }

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [recipients, setRecipients] = useState<Array<{ id: string; name: string }>>([]);
  // The first existing schedule bound to THIS dashboard (drives the run-history
  // panel and the pause/resume + delete controls). null = none / not-yet-loaded.
  const [schedule, setSchedule] = useState<ScheduledReport | null>(null);
  const [scheduleBusy, startScheduleMutation] = useTransition();

  // Re-fetch and re-bind this dashboard's schedule after a mutation.
  async function refreshSchedule(): Promise<void> {
    const r = await listSchedules(active.workspaceId);
    if (r.ok) setSchedule((r.data ?? []).find((s) => s.dashboardId === active.id) ?? null);
  }

  // Recipient options: reuse the workspace-members server action and map each
  // member to { id, name } (display name, falling back to email).
  useEffect(() => {
    let live = true;
    void (async () => {
      const members = await loadWorkspaceMembers(active.workspaceId);
      if (!live) return;
      setRecipients(members.map((m) => ({ id: m.id, name: m.name ?? m.email })));
    })();
    return () => {
      live = false;
    };
  }, [active.workspaceId]);

  // Find the first schedule for this dashboard so we can show its run history.
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await listSchedules(active.workspaceId);
      if (!live) return;
      setSchedule(r.ok ? (r.data ?? []).find((s) => s.dashboardId === active.id) ?? null : null);
    })();
    return () => {
      live = false;
    };
  }, [active.workspaceId, active.id]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <BarChart3 className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t('breadcrumb')}</div>
            <h2 className="text-base font-semibold text-foreground truncate">{active.name}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label={t('switchTo')}
            value={active.id}
            disabled={dashBusy}
            onChange={(e) => goToDashboard(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {dashboards.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name || t('untitledDashboard')}
                {d.isDefault ? ` (${t('defaultBadge')})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleNewDashboard}
            disabled={dashBusy}
            title={t('newDashboard')}
            aria-label={t('newDashboard')}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={handleRenameDashboard}
            disabled={dashBusy}
            title={t('renameDashboard')}
            aria-label={t('renameDashboard')}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            <Pencil className="size-4" />
          </button>
          {!active.isDefault && (
            <button
              type="button"
              onClick={handleMakeDefault}
              disabled={dashBusy}
              title={t('makeDefault')}
              aria-label={t('makeDefault')}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              <Star className="size-4" />
            </button>
          )}
          {!active.isDefault && dashboards.length > 1 && (
            <button
              type="button"
              onClick={handleDeleteDashboard}
              disabled={dashBusy}
              title={t('deleteDashboard')}
              aria-label={t('deleteDashboard')}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40"
          >
            <CalendarClock className="size-4" />
            {t2('title')}
          </button>
          <WorkspaceProjectSwitcher
            workspaces={ctx.workspaces}
            projects={ctx.projects}
            activeWorkspaceId={ctx.activeWorkspaceId}
            activeProjectId={ctx.activeProjectId}
          />
        </div>
      </div>

      <DashboardGrid dashboard={active} />

      {schedule ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 font-medium ${
              schedule.enabled ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            <span
              className={`size-2 rounded-full ${
                schedule.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/50'
              }`}
            />
            {schedule.enabled ? t2('activeLabel') : t2('pausedLabel')}
          </span>
          <span className="text-muted-foreground">
            {t2(schedule.cadence.freq)}
            {schedule.cadence.interval > 1 ? ` ×${schedule.cadence.interval}` : ''}
          </span>
          {schedule.nextRunAt ? (
            <span className="text-muted-foreground">
              {t2('nextRun')}: {new Date(schedule.nextRunAt).toLocaleDateString()}
            </span>
          ) : null}
          <div className="ms-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={scheduleBusy}
              onClick={() =>
                startScheduleMutation(async () => {
                  const r = await updateSchedule(schedule.id, { enabled: !schedule.enabled });
                  if (!r.ok) {
                    notifyActionError(r);
                    return;
                  }
                  setSchedule(r.data);
                })
              }
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50"
            >
              {schedule.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {schedule.enabled ? t2('pause') : t2('resume')}
            </button>
            <button
              type="button"
              disabled={scheduleBusy}
              onClick={() => {
                if (!window.confirm(t2('deleteConfirm'))) return;
                startScheduleMutation(async () => {
                  const r = await removeSchedule(schedule.id);
                  if (!r.ok) {
                    notifyActionError(r);
                    return;
                  }
                  setSchedule(null);
                });
              }}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              {t2('deleteSchedule')}
            </button>
          </div>
        </div>
      ) : null}

      {schedule ? <ScheduledRunHistory scheduleId={schedule.id} /> : null}

      {scheduleOpen ? (
        <ScheduleReportDialog
          workspaceId={active.workspaceId}
          dashboardId={active.id}
          recipientOptions={recipients}
          onClose={() => setScheduleOpen(false)}
          onCreated={() => {
            // Re-discover the schedule so the controls + run-history panel appear.
            void refreshSchedule();
          }}
        />
      ) : null}
    </div>
  );
}
