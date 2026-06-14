'use client';

import { useEffect, useState } from 'react';
import { BarChart3, CalendarClock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { ScheduleReportDialog } from '@/components/ScheduleReportDialog';
import { ScheduledRunHistory } from '@/components/ScheduledRunHistory';
import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
import { listSchedules } from '@/server/actions/scheduled-reports';
import { loadWorkspaceMembers } from '@/server/actions/members';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Dashboard } from '@projectflow/types';

interface Props {
  ctx: WorkspaceProjectContext;
  dashboards: Dashboard[];
  active: Dashboard;
}

export function DashboardView({ ctx, active }: Props) {
  const t = useTranslations('Dashboard');
  const t2 = useTranslations('ScheduledReport');

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [recipients, setRecipients] = useState<Array<{ id: string; name: string }>>([]);
  // Id of the first existing schedule bound to THIS dashboard (drives the
  // run-history panel). null = unknown/loading, '' = checked, none found.
  const [scheduleId, setScheduleId] = useState<string | null>(null);

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
      if (r.ok) {
        const match = (r.data ?? []).find((s) => s.dashboardId === active.id);
        setScheduleId(match ? match.id : '');
      } else {
        setScheduleId('');
      }
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

      {scheduleId ? <ScheduledRunHistory scheduleId={scheduleId} /> : null}

      {scheduleOpen ? (
        <ScheduleReportDialog
          workspaceId={active.workspaceId}
          dashboardId={active.id}
          recipientOptions={recipients}
          onClose={() => setScheduleOpen(false)}
          onCreated={() => {
            // Re-discover the schedule so the run-history panel appears.
            void (async () => {
              const r = await listSchedules(active.workspaceId);
              if (r.ok) {
                const match = (r.data ?? []).find((s) => s.dashboardId === active.id);
                if (match) setScheduleId(match.id);
              }
            })();
          }}
        />
      ) : null}
    </div>
  );
}
