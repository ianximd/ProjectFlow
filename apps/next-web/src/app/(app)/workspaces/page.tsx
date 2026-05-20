import { requireSession } from '@/server/session';
import { getWorkspacesDetailed } from '@/server/queries/workspaces';
import { WorkspacesView } from './workspaces-view';

export default async function WorkspacesPage() {
  const session = await requireSession();
  const workspaces = await getWorkspacesDetailed();
  return <WorkspacesView workspaces={workspaces} currentUserId={session.userId} />;
}
