import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getSprints } from '@/server/queries/sprints';
import { getTasks } from '@/server/queries/tasks';
import {
  getBurndown,
  getVelocity,
  getSprintSummary,
  getWorkload,
  getCreatedVsResolved,
} from '@/server/queries/reports';
import { DashboardView } from './dashboard-view';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sprint?: string }>;
}) {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');

  // ── No active project — render view with empty datasets ────────────────────
  if (!ctx.activeProjectId) {
    return (
      <DashboardView
        ctx={ctx}
        sprints={[]}
        activeSprintId={null}
        tasks={[]}
        burndown={null}
        velocity={[]}
        sprintSummary={null}
        workload={[]}
        createdVsResolved={[]}
      />
    );
  }

  // ── Fetch sprints first so we can resolve the active sprint from the URL ───
  const sprints = await getSprints(ctx.activeProjectId);

  // Resolve active sprint: prefer ?sprint= URL param (validated), then the
  // ACTIVE sprint, then the first sprint — matching the original CSR default.
  const { sprint: sprintParam } = await searchParams;
  const urlSprintId = sprintParam && sprints.some((s) => s.id === sprintParam)
    ? sprintParam
    : null;
  const activeSprintId =
    urlSprintId ??
    sprints.find((s) => s.status === 'ACTIVE')?.id ??
    sprints[0]?.id ??
    null;

  // ── Parallel fetch: reports + tasks ───────────────────────────────────────
  const [
    burndown,
    velocity,
    sprintSummary,
    workload,
    createdVsResolved,
    taskResult,
  ] = await Promise.all([
    activeSprintId
      ? getBurndown(activeSprintId).catch(() => null)
      : Promise.resolve(null),
    getVelocity(ctx.activeProjectId, 6).catch(() => []),
    activeSprintId
      ? getSprintSummary(activeSprintId).catch(() => null)
      : Promise.resolve(null),
    getWorkload(ctx.activeProjectId).catch(() => []),
    getCreatedVsResolved(ctx.activeProjectId, 8).catch(() => []),
    getTasks(ctx.activeProjectId, { pageSize: 500 }).catch(() => ({ tasks: [], assigneesByTaskId: {} })),
  ]);

  return (
    <DashboardView
      ctx={ctx}
      sprints={sprints}
      activeSprintId={activeSprintId}
      tasks={taskResult.tasks}
      burndown={burndown ?? null}
      velocity={(velocity as any[]) ?? []}
      sprintSummary={sprintSummary ?? null}
      workload={(workload as any[]) ?? []}
      createdVsResolved={(createdVsResolved as any[]) ?? []}
    />
  );
}
