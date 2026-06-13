'use client';

import { BarChart3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Dashboard } from '@projectflow/types';

interface Props {
  ctx: WorkspaceProjectContext;
  dashboards: Dashboard[];
  active: Dashboard;
}

export function DashboardView({ ctx, active }: Props) {
  const t = useTranslations('Dashboard');
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
        <WorkspaceProjectSwitcher
          workspaces={ctx.workspaces}
          projects={ctx.projects}
          activeWorkspaceId={ctx.activeWorkspaceId}
          activeProjectId={ctx.activeProjectId}
        />
      </div>
      <DashboardGrid dashboard={active} />
    </div>
  );
}
