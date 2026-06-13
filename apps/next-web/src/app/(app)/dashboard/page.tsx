import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { ensureWorkspaceDashboards, getDashboard } from '@/server/queries/dashboards';
import { DashboardView } from './dashboard-view';
import { DashboardPrint } from './print/dashboard-print';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; print?: string }>;
}) {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');

  const { id, print } = await searchParams;

  // Print mode renders the read-only, print-optimized layout for one dashboard.
  if (print === '1' && id) {
    const dashboard = await getDashboard(id);
    return <DashboardPrint dashboard={dashboard} />;
  }

  // Workspace-scoped dashboards for the active workspace; seed a default once.
  const dashboards = await ensureWorkspaceDashboards(ctx.activeWorkspaceId);
  const activeId = id && dashboards.some((d) => d.id === id) ? id : dashboards[0].id;
  const active = await getDashboard(activeId);

  return <DashboardView ctx={ctx} dashboards={dashboards} active={active} />;
}
