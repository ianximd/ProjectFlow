import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getTasks } from '@/server/queries/tasks';
import { getWorkflow } from '@/server/queries/workflows';
import { BoardView } from './board-view';
import BoardLoading from './loading';

export default async function BoardPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');

  const [tasksData, workflow] = ctx.activeProjectId
    ? await Promise.all([
        getTasks(ctx.activeProjectId),
        getWorkflow(ctx.activeProjectId),
      ])
    : [{ tasks: [], assigneesByTaskId: {} }, null];

  return (
    <Suspense fallback={<BoardLoading />}>
      <BoardView
        ctx={ctx}
        tasks={tasksData.tasks}
        assigneesByTaskId={tasksData.assigneesByTaskId}
        columns={workflow?.statuses ?? null}
      />
    </Suspense>
  );
}
