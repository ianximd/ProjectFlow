import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getTasks } from '@/server/queries/tasks';
import { getSprints } from '@/server/queries/sprints';
import { BacklogView } from './backlog-view';
import BacklogLoading from './loading';

export default async function BacklogPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');

  const [taskData, sprints] = ctx.activeProjectId
    ? await Promise.all([
        getTasks(ctx.activeProjectId, { pageSize: 200 }),
        getSprints(ctx.activeProjectId),
      ])
    : [{ tasks: [], assigneesByTaskId: {} }, []];

  // BacklogView reads useSearchParams (URL-persisted filters), which opts the
  // subtree out of static rendering and so must sit under a Suspense boundary.
  return (
    <Suspense fallback={<BacklogLoading />}>
      <BacklogView
        ctx={ctx}
        tasks={taskData.tasks}
        assigneesByTaskId={taskData.assigneesByTaskId}
        sprints={sprints}
      />
    </Suspense>
  );
}
