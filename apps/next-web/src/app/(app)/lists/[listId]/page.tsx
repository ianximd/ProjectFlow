import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getEverythingUnder } from '@/server/queries/hierarchy';
import { ListView } from './list-view';

export default async function ListPage({ params }: { params: Promise<{ listId: string }> }) {
  await requireSession();
  const { listId } = await params;
  const ctx = await getWorkspaceProjectContext();
  const tasks = await getEverythingUnder('LIST', listId);
  return <ListView listId={listId} workspaceId={ctx.activeWorkspaceId} tasks={tasks ?? []} />;
}
